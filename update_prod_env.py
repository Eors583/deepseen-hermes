import os

env_path = 'C:\\Users\\Administrator\\.hermes\\.env'
with open(env_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

new_lines = []
has_deepseen = False
for line in lines:
    if line.startswith('DEEPSEEN_API_KEY='):
        has_deepseen = True
        new_lines.append('DEEPSEEN_API_KEY=sk_ccc1b06341b17f567e806afe8aa69c298fe22d0ccd153aa1\n')
    else:
        new_lines.append(line)

if not has_deepseen:
    new_lines.append('DEEPSEEN_API_KEY=sk_ccc1b06341b17f567e806afe8aa69c298fe22d0ccd153aa1\n')
    new_lines.append('DEEPSEEN_BASE_URL=https://deepseen.ai/v1\n')
    new_lines.append('API_BASE_URL=https://deepseen.ai\n')

with open(env_path, 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Updated .env file successfully!")