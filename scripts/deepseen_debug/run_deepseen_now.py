import asyncio
import os
import sys
import logging
import dotenv

dotenv.load_dotenv(dotenv_path=r"C:\Users\Administrator\.hermes\.env")

logging.basicConfig(level=logging.DEBUG)
logging.getLogger("httpx").setLevel(logging.DEBUG)
logging.getLogger("tools.deepseen_tools").setLevel(logging.DEBUG)

from tools.deepseen_tools import _handle_video_recreation_create_and_wait

async def main():
    tool_input = {
        "reference_video_local_path": "C:/Users/Administrator/.hermes-web-ui/upload/default/c24e81e9770def12.mp4",
        "product_local_paths": ["C:/Users/Administrator/.hermes-web-ui/upload/default/810b1055358d507a.png"]
    }
    
    print("Calling Deepseen API...")
    result = await _handle_video_recreation_create_and_wait(tool_input)
    print("RESULT:")
    print(result)

if __name__ == "__main__":
    asyncio.run(main())