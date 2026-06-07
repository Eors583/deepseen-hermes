import yaml

with open('C:\\Users\\Administrator\\.hermes\\config.yaml', 'r', encoding='utf-8') as f:
    config = yaml.safe_load(f)

if 'auxiliary' not in config:
    config['auxiliary'] = {}

if 'vision' not in config['auxiliary']:
    config['auxiliary']['vision'] = {}

config['auxiliary']['vision']['provider'] = 'openai-api'
config['auxiliary']['vision']['model'] = 'gemini-3.1-flash-image-preview'
config['auxiliary']['vision']['base_url'] = 'https://api.ominilink.ai/v1'
config['auxiliary']['vision']['api_key'] = 'sk-d4c77696c9d54b7fa74ca7b2bb7e6e26'

with open('C:\\Users\\Administrator\\.hermes\\config.yaml', 'w', encoding='utf-8') as f:
    yaml.dump(config, f, allow_unicode=True, sort_keys=False)

print("Updated config.yaml")
