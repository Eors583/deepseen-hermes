import requests
import json

url = "https://api.ominilink.ai/v1/chat/completions"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-d4c77696c9d54b7fa74ca7b2bb7e6e26"
}
data = {
    "model": "gemini-3.1-pro-preview",
    "messages": [{"role": "user", "content": "Hello"}]
}

try:
    response = requests.post(url, headers=headers, json=data)
    print("Status Code:", response.status_code)
    print("Response Text:", response.text[:200])
except Exception as e:
    print("Error:", e)