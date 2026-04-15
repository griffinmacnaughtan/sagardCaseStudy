"""
Thin FastAPI server wrapping the portfolio metrics extraction pipeline.
Start: python api.py
"""

import json
import os
import subprocess
import threading
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import uvicorn

app = FastAPI(title="Sagard Portfolio Metrics API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE = Path(__file__).parent
OUTPUT = BASE / "output"
# Uploaded PDFs land here. Kept separate from the canonical ./pdfs/ sample set
# so a user-driven upload doesn't silently mix with the 25 provided reports.
UPLOADS = BASE / "uploads"

# Extraction state
_extract_state = {"running": False, "last_run": None, "error": None, "pdf_folder": None}
# Guards the running/start transition so two concurrent POSTs can't both spawn a
# thread and race on output/*.json writes.
_extract_lock = threading.Lock()


def _safe_read_json(path: Path):
    """Tolerate a half-written JSON (e.g. crash mid-extraction) by returning []
    instead of 500'ing the dashboard. The user can re-run extraction to recover."""
    try:
        return json.loads(path.read_text())
    except (json.JSONDecodeError, OSError):
        return []


def _get_file_timestamp(path: Path) -> str | None:
    if path.exists():
        return datetime.fromtimestamp(path.stat().st_mtime).isoformat()
    return None


def _find_pdf_folder() -> Path:
    """Find the PDF folder, checking common names."""
    if _extract_state["pdf_folder"]:
        p = Path(_extract_state["pdf_folder"])
        if p.exists():
            return p
    for name in ["pdfs", "PDF", "reports", "data"]:
        p = BASE / name
        if p.exists():
            return p
    return BASE / "pdfs"


@app.get("/metrics")
def get_metrics():
    path = OUTPUT / "portfolio_metrics.json"
    if not path.exists():
        return JSONResponse([], status_code=200)
    return _safe_read_json(path)


@app.get("/log")
def get_log():
    path = OUTPUT / "extraction_log.json"
    if not path.exists():
        return JSONResponse([], status_code=200)
    return _safe_read_json(path)


@app.get("/status")
def get_status():
    metrics_path = OUTPUT / "portfolio_metrics.json"
    pdf_folder = _find_pdf_folder()
    pdf_count = len(list(pdf_folder.glob("*.pdf"))) if pdf_folder.exists() else 0
    return {
        "running": _extract_state["running"],
        "last_run": _get_file_timestamp(metrics_path),
        "error": _extract_state["error"],
        "has_data": metrics_path.exists(),
        "pdf_count": pdf_count,
        "pdf_folder": str(pdf_folder),
    }


@app.get("/csv")
def get_csv():
    """Stream the canonical pivot CSV written by the extraction pipeline."""
    path = OUTPUT / "portfolio_metrics.csv"
    if not path.exists():
        return JSONResponse({"error": "CSV not found - run the extraction pipeline first"}, status_code=404)
    return FileResponse(path, media_type="text/csv", filename="portfolio_metrics.csv")


@app.get("/pdf/{filename}")
def get_pdf(filename: str):
    """Serve a source PDF for in-browser viewing."""
    pdf_folder = _find_pdf_folder()
    # Strip any directory components from the requested filename so the URL path
    # can't traverse out of pdf_folder (e.g. "../output/portfolio_metrics.json").
    safe_name = Path(filename).name
    pdf_path = pdf_folder / safe_name
    if not pdf_path.exists() or pdf_path.suffix.lower() != ".pdf":
        return JSONResponse({"error": "PDF not found"}, status_code=404)
    return FileResponse(pdf_path, media_type="application/pdf", filename=safe_name)


def _run_extraction(pdf_folder: str):
    try:
        _extract_state["running"] = True
        _extract_state["error"] = None
        result = subprocess.run(
            ["python", str(BASE / "poc.py"), pdf_folder],
            capture_output=True, text=True, timeout=300, cwd=str(BASE)
        )
        if result.returncode != 0:
            _extract_state["error"] = result.stderr or result.stdout
        _extract_state["last_run"] = datetime.now().isoformat()
    except Exception as e:
        _extract_state["error"] = str(e)
    finally:
        _extract_state["running"] = False


@app.post("/upload")
async def upload_pdfs(files: list[UploadFile] = File(...)):
    """Accept multiple PDF uploads, write them into ./uploads/, return the folder.

    The frontend calls this from a native file picker (<input type="file">), so
    the user selects PDFs with the OS dialog rather than typing a path. The
    uploads folder is cleared each call - we treat each upload batch as a new
    extraction "session" to avoid cruft accumulating from repeated demos.
    """
    UPLOADS.mkdir(exist_ok=True)
    # Clear prior uploads so successive batches don't blend. Only removes .pdf files
    # to avoid nuking anything the user might have dropped in manually.
    for old in UPLOADS.glob("*.pdf"):
        try:
            old.unlink()
        except OSError:
            pass

    saved = []
    for f in files:
        if not f.filename or not f.filename.lower().endswith(".pdf"):
            continue
        # Path.name strips any directory components the browser might send
        # (some browsers include relative paths when picking from webkitdirectory).
        safe_name = Path(f.filename).name
        dest = UPLOADS / safe_name
        dest.write_bytes(await f.read())
        saved.append(safe_name)

    _extract_state["pdf_folder"] = str(UPLOADS)
    return {"folder": str(UPLOADS), "count": len(saved), "files": saved}


@app.post("/extract")
def trigger_extraction(body: dict = {}):
    # Atomic check-and-claim so two near-simultaneous POSTs can't both spawn
    # extraction threads and race on output/*.json writes.
    with _extract_lock:
        if _extract_state["running"]:
            return {"status": "already_running"}
        folder = body.get("folder") or str(_find_pdf_folder())
        _extract_state["pdf_folder"] = folder
        _extract_state["running"] = True  # claim before releasing lock
    thread = threading.Thread(target=_run_extraction, args=(folder,), daemon=True)
    thread.start()
    return {"status": "started", "folder": folder}


if __name__ == "__main__":
    # Auto-reload on code edits only. Without the excludes, uvicorn's watcher
    # sees new PDFs written to ./uploads/ or ./output/ and restarts mid-request,
    # aborting uploads with ERR_CONNECTION_ABORTED. Scope the watcher to .py files
    # so data writes don't trigger a reload.
    uvicorn.run(
        "api:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        reload_dirs=[str(BASE)],
        reload_includes=["*.py"],
        reload_excludes=["uploads/*", "output/*", "pdfs/*", "dashboard/*", "*.pdf", "*.json", "*.csv"],
    )
