import asyncio
import os
import sys

# Set up Hermes environment so config is loaded correctly
os.environ["HERMES_HOME"] = "C:\\Users\\Administrator\\.hermes"

# Mock image
with open("test_image.png", "wb") as f:
    # 1x1 transparent PNG
    f.write(b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0bIDAT\x08\xd7c\x60\x00\x02\x00\x00\x05\x00\x01\xe2+\xfe\x0b\x00\x00\x00\x00IEND\xaeB`\x82')

async def main():
    from tools.vision_tools import vision_analyze_tool
    print("Testing vision_analyze_tool...")
    try:
        result = await vision_analyze_tool(
            image_url=os.path.abspath("test_image.png"),
            user_prompt="What is this?"
        )
        print("Result:", result)
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(main())
