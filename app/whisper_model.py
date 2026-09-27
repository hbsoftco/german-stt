import os
from faster_whisper import WhisperModel


MODEL_ID = os.getenv(
    "ASR_MODEL_ID",
    "Systran/faster-whisper-large-v3"
)

COMPUTE_TYPE = os.getenv(
    "ASR_COMPUTE_TYPE",
    "float16"
)

_model = None


def get_model():

    global _model

    if _model is None:

        print("Loading Whisper model...")

        _model = WhisperModel(
            MODEL_ID,
            device="cuda",
            compute_type=COMPUTE_TYPE,
            download_root=os.getenv(
                "MODELS_DIR",
                "/models"
            )
        )

        print(
            "Whisper model loaded successfully"
        )

    return _model
