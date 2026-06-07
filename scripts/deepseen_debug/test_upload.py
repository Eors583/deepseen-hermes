import asyncio
import os
import sys
import logging
import dotenv

dotenv.load_dotenv(dotenv_path=r"C:\Users\Administrator\.hermes\.env")

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("httpx").setLevel(logging.DEBUG)

from tools.deepseen_tools import _handle_video_recreation_create_and_wait, _http_upload

async def main():
    base_url = "https://deepseen.ai/v1"
    api_key = os.getenv("DEEPSEEN_API_KEY")
    local_path = "C:/Users/Administrator/.hermes-web-ui/upload/default/810b1055358d507a.png"
    print(f"Uploading file: {local_path} with key: {api_key[:5]}...")
    try:
        api_file = await _http_upload(base_url, api_key, local_path, "product_image")
        print("Upload Result:", api_file)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
