<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NAlert, NButton, NInput, NSpin, NTag, useMessage } from 'naive-ui'
import {
  fetchToolCredentials,
  saveToolCredentials,
  type ToolCredentialInfo,
} from '@/api/hermes/config'

const message = useMessage()

const loading = ref(false)
const savingKey = ref<string | null>(null)
const credentials = ref<ToolCredentialInfo[]>([])
const drafts = ref<Record<string, string>>({})

async function loadCredentials() {
  loading.value = true
  try {
    const result = await fetchToolCredentials()
    credentials.value = result.credentials
    const nextDrafts: Record<string, string> = {}
    for (const item of result.credentials) {
      nextDrafts[item.key] = item.secret ? '' : item.redacted_value || ''
    }
    drafts.value = nextDrafts
  } catch (err: any) {
    message.error(err.message || '加载工具密钥失败')
  } finally {
    loading.value = false
  }
}

async function saveCredential(item: ToolCredentialInfo) {
  const value = (drafts.value[item.key] || '').trim()
  if (item.required && item.secret && !value) {
    message.warning(`请输入 ${item.label}`)
    return
  }

  savingKey.value = item.key
  try {
    await saveToolCredentials({ [item.key]: value })
    message.success(`${item.label} 已保存，Herbound gateway 正在重启`)
    await loadCredentials()
  } catch (err: any) {
    message.error(err.message || '保存工具密钥失败')
  } finally {
    savingKey.value = null
  }
}

async function clearCredential(item: ToolCredentialInfo) {
  savingKey.value = item.key
  try {
    await saveToolCredentials({ [item.key]: '' })
    message.success(`${item.label} 已清除，Herbound gateway 正在重启`)
    await loadCredentials()
  } catch (err: any) {
    message.error(err.message || '清除工具密钥失败')
  } finally {
    savingKey.value = null
  }
}

onMounted(() => {
  void loadCredentials()
})
</script>

<template>
  <section class="settings-section">
    <NAlert type="info" :bordered="false" class="restart-hint">
      Deepseen 是工具能力密钥，不是模型 provider。保存后会写入当前 Herbound profile 的 .env，并重启 Herbound gateway 让 agent 读取新配置。
    </NAlert>

    <NSpin :show="loading">
      <div class="credential-list">
        <div v-for="item in credentials" :key="item.key" class="credential-section">
          <div class="credential-header">
            <div>
              <div class="credential-title-row">
                <h4 class="credential-name">{{ item.label }}</h4>
                <NTag v-if="item.required" size="small" type="warning" :bordered="false">必填</NTag>
                <NTag v-if="item.is_set" size="small" type="success" :bordered="false">已设置</NTag>
                <NTag v-else size="small" type="default" :bordered="false">未设置</NTag>
              </div>
              <p class="credential-desc">{{ item.description }}</p>
            </div>
            <span class="credential-key">{{ item.key }}</span>
          </div>

          <div class="field-row">
            <NInput
              v-model:value="drafts[item.key]"
              :type="item.secret ? 'password' : 'text'"
              :show-password-on="item.secret ? 'click' : undefined"
              :placeholder="item.secret && item.is_set ? item.redacted_value : item.placeholder || item.label"
              autocomplete="off"
            />
            <NButton
              type="primary"
              size="small"
              :loading="savingKey === item.key"
              @click="saveCredential(item)"
            >
              保存
            </NButton>
            <NButton
              v-if="item.is_set"
              size="small"
              tertiary
              :loading="savingKey === item.key"
              @click="clearCredential(item)"
            >
              清除
            </NButton>
          </div>
        </div>
      </div>
    </NSpin>
  </section>
</template>

<style scoped lang="scss">
@use '@/styles/variables' as *;

.settings-section {
  margin-top: 16px;
}

.restart-hint {
  margin-bottom: 14px;
}

.credential-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.credential-section {
  border: 1px solid $border-color;
  border-radius: $radius-md;
  padding: 16px;
  background: $bg-card;
}

.credential-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.credential-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.credential-name {
  font-size: 14px;
  font-weight: 600;
  color: $text-primary;
  margin: 0;
}

.credential-desc {
  font-size: 12px;
  color: $text-muted;
  margin: 6px 0 0;
  line-height: 1.5;
}

.credential-key {
  flex-shrink: 0;
  font-family: $font-code;
  font-size: 12px;
  color: $text-muted;
  padding-top: 2px;
}

.field-row {
  display: flex;
  align-items: center;
  gap: 10px;

  .n-input {
    flex: 1;
  }
}

@media (max-width: 720px) {
  .credential-header,
  .field-row {
    flex-direction: column;
    align-items: stretch;
  }

  .credential-key {
    word-break: break-all;
  }
}
</style>
