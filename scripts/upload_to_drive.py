#!/usr/bin/env python3
"""Optional Google Drive upload for a GitHub Actions service account."""
import json
import os
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

def main() -> int:
    source = Path(sys.argv[1])
    if not source.is_file():
        raise FileNotFoundError(source)
    raw = os.environ["GDRIVE_SERVICE_ACCOUNT_JSON"]
    folder_id = os.environ["GDRIVE_FOLDER_ID"]
    info = json.loads(raw)
    credentials = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/drive"]
    )
    service = build("drive", "v3", credentials=credentials, cache_discovery=False)
    metadata = {"name": source.name, "parents": [folder_id], "mimeType": "application/zip"}
    media = MediaFileUpload(str(source), mimetype="application/zip", resumable=True)
    result = service.files().create(
        body=metadata,
        media_body=media,
        fields="id,name,webViewLink,size",
        supportsAllDrives=True,
    ).execute()
    print(json.dumps(result, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
