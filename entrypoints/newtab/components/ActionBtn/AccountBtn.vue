<script lang="ts" setup>
import { useTranslation } from 'i18next-vue'
import { ElMessage } from 'element-plus'
import EmailRound from '~icons/ic/round-email'
import LogoutRound from '~icons/ic/round-logout'
import ManageAccountsRound from '~icons/ic/round-manage-accounts'
import PersonRound from '~icons/ic/round-person'
import PersonOffRound from '~icons/ic/round-person-off'

import AuthDialog from '../AuthDialog.vue'
import PersonalCenterDialog from '../PersonalCenterDialog.vue'
import {
  fetchCloudDock,
  isStartCloudEnabled,
  saveCloudDock,
} from '@/shared/cloud/startApi'
import { useQuickLinksStore } from '@/shared/quickLinks'
import { getAuthSession, logoutAccount, type AuthSession } from '@newtab/shared/auth'

const { t } = useTranslation()
const dialogVisible = ref(false)
const centerVisible = ref(false)
const session = ref<AuthSession | null>(null)
const quickLinksStore = useQuickLinksStore()
let stopDockSync: (() => void) | undefined
let dockSyncTimer: ReturnType<typeof setTimeout> | undefined

onMounted(async () => {
  session.value = await getAuthSession()
  if (session.value) {
    await syncDockAfterLogin(session.value)
    startDockSync(session.value)
  }
})

async function logout() {
  await logoutAccount()
  session.value = null
  stopDockSync?.()
  stopDockSync = undefined
  window.dispatchEvent(new CustomEvent('start-account-signed-out'))
  ElMessage.success(t('account.signedOut'))
}

async function handleSignedIn(nextSession: AuthSession) {
  session.value = nextSession
  await syncDockAfterLogin(nextSession)
  startDockSync(nextSession)
  window.dispatchEvent(new CustomEvent('start-account-signed-in'))
}

async function syncDockAfterLogin(nextSession: AuthSession) {
  if (!isStartCloudEnabled()) return
  try {
    const cloudDock = await fetchCloudDock(nextSession.email)
    const hasCloudDock = cloudDock.items.length > 0 || (cloudDock.groups?.length ?? 0) > 0
    if (hasCloudDock) {
      await quickLinksStore.save(cloudDock)
    } else {
      await saveCloudDock(nextSession.email, {
        items: structuredClone(toRaw(quickLinksStore.items)),
        groups: structuredClone(toRaw(quickLinksStore.groups)),
      })
    }
  } catch (error) {
    ElMessage.warning(error instanceof Error ? error.message : 'Dock 同步失败')
  }
}

function startDockSync(nextSession: AuthSession) {
  if (!isStartCloudEnabled()) return
  stopDockSync?.()
  stopDockSync = quickLinksStore.$subscribe(() => {
    if (dockSyncTimer) clearTimeout(dockSyncTimer)
    dockSyncTimer = setTimeout(() => {
      void saveCloudDock(nextSession.email, {
        items: structuredClone(toRaw(quickLinksStore.items)),
        groups: structuredClone(toRaw(quickLinksStore.groups)),
      }).catch(() => undefined)
    }, 500)
  })
}
</script>

<template>
  <el-dropdown
    v-if="session"
    style="display: block"
    popper-class="account-btn__popper"
    :show-arrow="false"
    placement="bottom-end"
    trigger="click"
    @contextmenu.prevent.stop
  >
    <div role="button" tabindex="0" class="action-btn account-btn account-btn--signed-in">
      <el-icon class="action-icon action-icon--a"><person-round /></el-icon>
      <el-icon class="action-icon action-icon--b"><manage-accounts-round /></el-icon>
      <span class="account-btn__dot"></span>
    </div>
    <template #dropdown>
      <el-dropdown-menu class="noselect account-btn__menu">
        <el-dropdown-item disabled :icon="EmailRound">
          <span class="account-btn__email">{{ session.email }}</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="ManageAccountsRound" @click="centerVisible = true">
          <span>个人中心</span>
        </el-dropdown-item>
        <el-dropdown-item :icon="LogoutRound" @click="logout">
          <span>{{ t('account.logout') }}</span>
        </el-dropdown-item>
      </el-dropdown-menu>
    </template>
  </el-dropdown>

  <div
    v-else
    role="button"
    tabindex="0"
    class="action-btn account-btn"
    :title="t('account.open')"
    @click="dialogVisible = true"
    @keydown.enter="dialogVisible = true"
  >
    <el-icon class="action-icon action-icon--a"><person-off-round /></el-icon>
    <el-icon class="action-icon action-icon--b"><person-round /></el-icon>
  </div>

  <auth-dialog v-if="dialogVisible" v-model="dialogVisible" @signed-in="handleSignedIn" />
  <personal-center-dialog
    v-if="centerVisible && session"
    v-model="centerVisible"
    :session="session"
  />
</template>

<style lang="scss">
.account-btn {
  overflow: visible;

  &::before,
  &::after {
    display: none;
  }

  &--signed-in {
    color: var(--el-color-primary);
  }

  &__dot {
    position: absolute;
    right: 4px;
    bottom: 5px;
    width: 7px;
    height: 7px;
    background: var(--el-color-success);
    border: 1px solid var(--el-bg-color-overlay);
    border-radius: 50%;
  }

  &__email {
    display: inline-block;
    max-width: 180px;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--el-text-color-regular);
  }

  &__menu .el-dropdown-menu__item {
    max-width: 220px;
  }
}
</style>
