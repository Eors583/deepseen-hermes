import yaml

with open('C:\\Users\\Administrator\\.hermes\\config.yaml', 'r', encoding='utf-8') as f:
    config = yaml.safe_load(f)

if 'deepseen_ai' in config and 'gemini_base_url' in config['deepseen_ai']:
    config['deepseen_ai']['gemini_base_url'] = 'https://api.ominilink.ai/v1'

with open('C:\\Users\\Administrator\\.hermes\\config.yaml', 'w', encoding='utf-8') as f:
    yaml.dump(config, f, allow_unicode=True, sort_keys=False)

print("Updated config.yaml successfully!")