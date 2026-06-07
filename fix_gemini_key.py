import os
import re

env_path = 'C:\\Users\\Administrator\\.hermes\\.env'
with open(env_path, 'r', encoding='utf-8') as f:
    content = f.read()

content = re.sub(r'GEMINI_API_KEY=.*', 'GEMINI_API_KEY=sk-d4c77696c9d54b7fa74ca7b2bb7e6e26', content)
content = re.sub(r'GOOGLE_API_KEY=.*', 'GOOGLE_API_KEY=sk-d4c77696c9d54b7fa74ca7b2bb7e6e26', content)
content = re.sub(r'GOOGLE_AI_API_KEY=.*', 'GOOGLE_AI_API_KEY=sk-d4c77696c9d54b7fa74ca7b2bb7e6e26', content)

with open(env_path, 'w', encoding='utf-8') as f:
    f.write(content)

print("Fixed Gemini keys in ~/.hermes/.env")