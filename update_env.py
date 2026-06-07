import os

env_path = 'C:\\Users\\Administrator\\.hermes\\.env'
with open(env_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
for line in lines:
    if line.startswith('GEMINI_BASE_URL=') and line.strip().endswith('api.ominilink.ai'):
        new_lines.append('GEMINI_BASE_URL=https://api.ominilink.ai/v1\n')
    elif line.startswith('GOOGLE_AI_BASE_URL=') and line.strip().endswith('api.ominilink.ai'):
        new_lines.append('GOOGLE_AI_BASE_URL=https://api.ominilink.ai/v1\n')
    else:
        new_lines.append(line)

with open(env_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Updated .env file successfully!")