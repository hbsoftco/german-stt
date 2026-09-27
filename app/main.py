import os
import shutil
import tempfile
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles

from app.whisper_model import get_model


app = FastAPI(
    title="Diana German STT Service",
    version="1.0.0"
)


@app.on_event("startup")
def startup_event():

    preload = os.getenv(
        "PRELOAD_MODEL",
        "0"
    )

    if preload == "1":
        get_model()


@app.get("/health")
def health():

    return {
        "status": "ok",
        "service": "german-stt"
    }


@app.get("/model-status")
def model_status():

    return {
        "model": os.getenv("ASR_MODEL_ID"),
        "compute_type": os.getenv("ASR_COMPUTE_TYPE"),
        "device": "cuda"
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...)
):

    if not file.filename:
        raise HTTPException(
            status_code=400,
            detail="Missing filename"
        )

    suffix = os.path.splitext(
        file.filename
    )[1]

    with tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix
    ) as temp:

        shutil.copyfileobj(
            file.file,
            temp
        )

        audio_path = temp.name


    try:

        model = get_model()

        segments, info = model.transcribe(
            audio_path,
            language="de",
            beam_size=5
        )


        result_segments = []

        full_text = []

        for segment in segments:

            result_segments.append(
                {
                    "start": segment.start,
                    "end": segment.end,
                    "text": segment.text.strip()
                }
            )

            full_text.append(
                segment.text.strip()
            )


        return {
            "language": info.language,
            "duration": info.duration,
            "text": " ".join(full_text),
            "segments": result_segments
        }


    finally:

        if os.path.exists(audio_path):
            os.remove(audio_path)


# Mounted last so the API routes above take precedence.
app.mount(
    "/",
    StaticFiles(
        directory=Path(__file__).resolve().parent.parent / "frontend",
        html=True
    ),
    name="frontend"
)
