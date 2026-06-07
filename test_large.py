import requests

url = "https://api.ominilink.ai/v1/chat/completions"
headers = {"Content-Type": "application/json", "Authorization": "Bearer sk-d4c77696c9d54b7fa74ca7b2bb7e6e26"}
data = '{"model": "gemini-3.1-pro-preview", "messages": [{"role": "user", "content": "' + 'x'*15000000 + '"}]}'

try:
    r = requests.post(url, headers=headers, data=data)
    print("Status:", r.status_code)
    print("Text:", repr(r.text[:100]))
except Exception as e:
    print(e)