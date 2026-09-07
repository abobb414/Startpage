<script setup lang="ts">
import { ElMessage } from 'element-plus'
import CloseRound from '~icons/ic/round-close'
import EditRound from '~icons/ic/round-edit'
import RssFeedRound from '~icons/ic/round-rss-feed'
import StickyNote2Round from '~icons/ic/round-sticky-note-2'
import TrendingUpRound from '~icons/ic/round-trending-up'

import {
  createNote,
  fetchDashboard,
  fetchHotList,
  type HotListData,
  type HotListKind,
  type HotListItem,
  isStartCloudEnabled,
  updateNote,
  type DashboardData,
  type StartNote,
} from '@/shared/cloud/startApi'
import { getAuthSession, type AuthSession } from '@newtab/shared/auth'

type PanelKind = 'notes' | 'rss'
type HotListCacheEntry = {
  data: HotListData
  fetchedAt: number
}

const HOT_LIST_STALE_MS = 15 * 60 * 1000
const DONE_STYLE = { color: 'var(--el-text-color-placeholder)', textDecoration: 'line-through' }

const session = ref<AuthSession | null>(null)
const dashboard = ref<DashboardData | null>(null)
const noteBody = ref('')
const loading = ref(false)
const hotLoading = ref(false)
const panelOpen = ref(false)
const activePanel = ref<PanelKind>('notes')
const hotKind = ref<HotListKind>('zhihu')
const hotLists = reactive<Partial<Record<HotListKind, HotListCacheEntry>>>({})

const visible = computed(() => Boolean(session.value && isStartCloudEnabled()))
const activeNotes = computed(() => (dashboard.value?.notes ?? []).slice(0, 20))
const panelTitle = computed(() => (activePanel.value === 'notes' ? '便签' : '热榜'))
const currentHotList = computed(() => hotLists[hotKind.value]?.data)
const hotItems = computed(() => (currentHotList.value?.data ?? []).slice(0, 20))
const hotOptions: Array<{ label: string; value: HotListKind }> = [
  { label: '知乎', value: 'zhihu' },
  { label: '掘金', value: 'juejin' },
  { label: 'HN', value: 'hackernews' },
]

async function load() {
  session.value = await getAuthSession()
  if (!session.value || !isStartCloudEnabled()) return
  loading.value = true
  try {
    dashboard.value = await fetchDashboard(session.value.email)
  } finally {
    loading.value = false
  }
}

async function loadHotList(kind = hotKind.value, force = false) {
  if (!isStartCloudEnabled()) return
  const cached = hotLists[kind]
  if (cached && !force && !isHotListStale(cached.fetchedAt)) return
  hotLoading.value = true
  try {
    hotLists[kind] = {
      data: await fetchHotList(kind),
      fetchedAt: Date.now(),
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '热榜加载失败')
  } finally {
    hotLoading.value = false
  }
}

function isHotListStale(fetchedAt: number) {
  const now = Date.now()
  if (now - fetchedAt > HOT_LIST_STALE_MS) return true
  return new Date(now).toDateString() !== new Date(fetchedAt).toDateString()
}

async function addNote() {
  if (!session.value) return
  const body = noteBody.value.trim()
  if (!body) return
  try {
    const result = await createNote(session.value.email, body)
    noteBody.value = ''
    const notes = dashboard.value?.notes
    if (notes) {
      notes.unshift({ id: result.note.id, title: result.note.title, body: result.note.body, done: 0 })
    }
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : '保存失败')
  }
}

async function toggleNote(id: string, done: number | boolean) {
  if (!session.value) return
  const note = dashboard.value?.notes?.find((n) => n.id === id)
  if (note) note.done = done ? 0 : 1
  try {
    await updateNote(session.value.email, id, { done: !done })
  } catch (error) {
    if (note) note.done = done ? 1 : 0
    ElMessage.error(error instanceof Error ? error.message : '更新失败')
  }
}

function openPanel(kind: PanelKind) {
  activePanel.value = kind
  panelOpen.value = true
  void load()
  if (kind === 'rss') void loadHotList()
}

function formatNoteDate(note: StartNote) {
  const date = new Date(note.createdAt || note.updatedAt || Date.now())
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

function formatHotMeta(item: HotListItem) {
  return [item.hot, item.desc].filter(Boolean).join(' · ')
}

onMounted(load)
watch(hotKind, (kind) => {
  if (panelOpen.value && activePanel.value === 'rss') void loadHotList(kind)
})
window.addEventListener('start-account-signed-in', () => void load())
window.addEventListener('start-account-signed-out', () => {
  session.value = null
  dashboard.value = null
  panelOpen.value = false
})
</script>

<template>
  <template v-if="visible">
    <button
      type="button"
      class="action-btn widgets-board__trigger widgets-board__trigger--rss"
      title="热榜"
      aria-label="打开热榜"
      @click="openPanel('rss')"
    >
      <el-icon class="action-icon action-icon--a"><rss-feed-round /></el-icon>
      <el-icon class="action-icon action-icon--b"><trending-up-round /></el-icon>
    </button>
    <button
      type="button"
      class="action-btn widgets-board__trigger widgets-board__trigger--notes"
      title="便签"
      aria-label="打开便签"
      @click="openPanel('notes')"
    >
      <el-icon class="action-icon action-icon--a"><sticky-note2-round /></el-icon>
      <el-icon class="action-icon action-icon--b"><edit-round /></el-icon>
    </button>

    <teleport to="body">
      <transition name="widgets-board__fade">
        <div
          v-if="panelOpen"
          class="widgets-board__scrim"
          aria-hidden="true"
          @click="panelOpen = false"
        ></div>
      </transition>
      <transition name="widgets-board__slide">
        <aside
          v-if="panelOpen"
          v-loading="loading"
          class="widgets-board__drawer"
          :class="`widgets-board__drawer--${activePanel}`"
          aria-modal="true"
          role="dialog"
          :aria-label="panelTitle"
          @contextmenu.stop
        >
          <header class="widgets-board__header">
            <div class="widgets-board__title">
              <img src="/favicon.png" alt="Startpage" />
              <div>
                <h2>{{ panelTitle }}</h2>
                <p v-if="activePanel === 'notes'">只保留最近三天</p>
                <p v-else>{{ currentHotList?.title || '聚合热榜已接入' }}</p>
              </div>
            </div>
            <button
              type="button"
              class="widgets-board__close"
              aria-label="关闭"
              @click="panelOpen = false"
            >
              <el-icon><close-round /></el-icon>
            </button>
          </header>

          <section v-if="activePanel === 'notes'" class="widgets-board__section">
            <div class="widgets-board__input">
              <el-input
                v-model="noteBody"
                placeholder="记一件事"
                size="large"
                @keyup.enter="addNote"
              />
              <el-button type="primary" size="large" @click="addNote">添加</el-button>
            </div>
            <div class="widgets-board__list">
              <button
                v-for="note in activeNotes"
                :key="note.id"
                class="widgets-board__note"
                type="button"
                @click="toggleNote(note.id, note.done)"
              >
                <span
                  class="widgets-board__note-body"
                  :style="note.done ? DONE_STYLE : null"
                >
                  {{ note.body || note.title }}
                </span>
                <time class="widgets-board__note-date">{{ formatNoteDate(note) }}</time>
              </button>
              <p v-if="!activeNotes.length" class="widgets-board__empty">暂无便签</p>
            </div>
          </section>

          <section v-else class="widgets-board__section">
            <el-segmented
              v-model="hotKind"
              class="widgets-board__hot-tabs"
              :options="hotOptions"
              block
            />
            <div class="widgets-board__list widgets-board__list--hot" :aria-busy="hotLoading">
              <a
                v-for="item in hotItems"
                :key="`${hotKind}:${item.index}:${item.title}`"
                class="widgets-board__hot"
                :href="item.mobileUrl || item.url"
                target="_blank"
                rel="noopener noreferrer"
              >
                <strong>{{ item.index }}</strong>
                <span>{{ item.title }}</span>
                <small>{{ formatHotMeta(item) }}</small>
              </a>
              <p v-if="!hotItems.length && !hotLoading" class="widgets-board__empty">暂无热榜</p>
            </div>
          </section>
        </aside>
      </transition>
    </teleport>
  </template>
</template>

<style lang="scss">
.widgets-board {
  &__trigger {
    overflow: visible;
    color: inherit;
    background: transparent;
    border: 0;
    transform: translateZ(0);

    &::before,
    &::after {
      display: none;
    }

    &:hover,
    &:focus-visible {
      .el-icon {
        filter: drop-shadow(0 0 4px rgb(255 255 255 / 70%));
      }
    }

    &--notes {
      &::before {
        top: 8px;
        right: 8px;
        width: 11px;
        height: 11px;
        background: color-mix(in srgb, var(--el-color-warning) 82%, white);
        border-radius: 2px;
        clip-path: polygon(0 0, 100% 0, 100% 100%, 58% 82%, 0 100%);
        transform: translate(-6px, 4px) rotate(-18deg) scale(0.2);
        transform-origin: 50% 50%;
      }

      &::after {
        bottom: 10px;
        left: 10px;
        width: 14px;
        height: 2px;
        background: currentColor;
        border-radius: 999px;
        box-shadow:
          0 -5px 0 currentColor,
          0 -10px 0 currentColor;
        transform: translateX(7px) scaleX(0.12);
        transform-origin: left center;
      }

      &:hover,
      &:focus-visible {
        .el-icon {
          filter: drop-shadow(0 0 4px rgb(255 255 255 / 70%));
        }

        &::before {
          animation: none;
        }

        &::after {
          animation: none;
        }
      }
    }

    &--rss {
      &::before,
      &::after {
        inset: 11px auto auto 10px;
        width: 6px;
        height: 6px;
        border: 2px solid currentColor;
        border-radius: 50%;
        transform: scale(0.3);
      }

      &::after {
        inset: 7px auto auto 6px;
        width: 14px;
        height: 14px;
        border-top-color: transparent;
        border-left-color: transparent;
        transition-delay: 45ms;
      }

      &:hover,
      &:focus-visible {
        .el-icon {
          filter: drop-shadow(0 0 4px rgb(255 255 255 / 70%));
        }

        &::before,
        &::after {
          animation: none;
        }

        &::after {
          animation-delay: 80ms;
        }
      }
    }
  }

  &__scrim {
    position: fixed;
    inset: 0;
    z-index: 1999;
    background: rgb(0 0 0 / 26%);
    backdrop-filter: blur(1px);
  }

  &__drawer {
    position: fixed;
    inset: 10px 10px 10px auto;
    z-index: 2000;
    display: flex;
    flex-direction: column;
    width: min(400px, calc(100vw - 20px));
    max-width: calc(100% - 20px);
    padding: 20px;
    overflow: hidden;
    color: var(--el-text-color-primary);
    background: color-mix(in srgb, var(--el-bg-color-page) 84%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-border-color) 54%, transparent);
    border-radius: 20px;
    box-shadow:
      0 0 18px 2px color-mix(in srgb, var(--el-bg-color-page) 54%, transparent),
      0 18px 48px rgb(0 0 0 / 22%);
    backdrop-filter: blur(20px) saturate(1.25);
    clip-path: inset(0 round 20px);
    transform-origin: right center;

    html.colorful & {
      background: color-mix(in srgb, var(--el-color-primary-light-9) 82%, transparent);
    }

    .el-loading-mask {
      background-color: transparent;
      backdrop-filter: none;
    }

    .el-loading-spinner {
      filter: drop-shadow(0 4px 12px rgb(0 0 0 / 18%));
    }
  }

  &__header {
    display: flex;
    gap: 16px;
    align-items: flex-start;
    justify-content: space-between;
    margin-bottom: 22px;

    h2 {
      margin: 0;
      font-size: 22px;
      font-weight: 700;
    }

    p {
      margin: 4px 0 0;
      font-size: 13px;
      color: var(--el-text-color-secondary);
    }
  }

  &__title {
    display: flex;
    gap: 12px;
    align-items: center;
    min-width: 0;

    img {
      display: none;
      flex: 0 0 auto;
      width: 34px;
      height: 34px;
      object-fit: contain;
      border-radius: 50%;
    }
  }

  &__close {
    display: grid;
    flex: 0 0 auto;
    place-items: center;
    width: 44px;
    height: 44px;
    padding: 0;
    color: var(--el-text-color-secondary);
    cursor: pointer;
    background: transparent;
    border: 0;
    border-radius: 50%;
    box-shadow: none;
    transition:
      color 180ms ease,
      background-color 180ms ease,
      transform 180ms ease;

    &::before,
    &::after {
      display: none;
    }

    .el-icon {
      width: 18px;
      height: 18px;
      font-size: 18px;
    }

    &:hover,
    &:focus-visible {
      color: var(--el-color-primary);
      outline: none;
      background: color-mix(in srgb, var(--el-color-primary) 10%, transparent);
      border-radius: 50%;
      box-shadow: none;
      transform: scale(1.04);
    }
  }

  &__section {
    min-height: 0;
    overflow: hidden;
  }

  &__input {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 8px;
    margin-bottom: 16px;

    .el-input__wrapper {
      border-radius: 999px;
      transition:
        background-color 180ms ease,
        box-shadow 180ms ease;

      &.is-focus {
        background-color: color-mix(in srgb, var(--el-fill-color-blank) 88%, transparent);
        box-shadow: 0 0 0 1px color-mix(in srgb, var(--el-color-warning) 42%, transparent) inset;
      }
    }

    .el-button {
      border-radius: 999px;
    }
  }

  &__list {
    display: grid;
    gap: 10px;
    max-height: calc(100vh - 140px);
    overflow: auto;
    scrollbar-width: none;

    &::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .el-loading-mask {
      background-color: transparent;
    }

    &--hot {
      max-height: calc(100vh - 190px);
      padding-top: 4px;
    }
  }

  &__note,
  &__hot {
    min-width: 0;
    padding: 12px;
    color: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    background: color-mix(in srgb, var(--el-bg-color) 72%, transparent);
    border: 1px solid color-mix(in srgb, var(--el-border-color) 58%, transparent);
    border-radius: 8px;
    box-shadow: 0 8px 20px rgb(0 0 0 / 3%);
    transition:
      border-color 180ms ease,
      box-shadow 180ms ease,
      background-color 180ms ease,
      transform 180ms ease;

    &:hover,
    &:focus-visible {
      border-color: color-mix(in srgb, var(--el-color-primary) 36%, var(--el-border-color));
      box-shadow: 0 12px 24px rgb(0 0 0 / 7%);
      transform: translateX(-2px);
    }
  }

  &__note {
    display: grid;
    gap: 6px;
  }

  &__note-body {
    font-size: 14px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

  &__note-date {
    font-size: 12px;
    color: var(--el-text-color-placeholder);
  }

  &__hot-tabs {
    position: relative;
    z-index: 1;
    padding: 3px;
    margin-bottom: 10px;
    overflow: hidden;
    background: color-mix(in srgb, var(--el-fill-color-blank) 78%, transparent);
    border-radius: 999px;
    box-shadow: 0 8px 18px rgb(0 0 0 / 4%);

    .el-segmented__item {
      border-radius: 999px;
    }

    .el-segmented__item-selected {
      box-shadow: 0 5px 14px color-mix(in srgb, var(--el-color-primary) 24%, transparent);
    }
  }

  &__hot {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr);
    gap: 4px 10px;
    align-items: center;

    strong {
      display: grid;
      grid-row: span 2;
      place-items: center;
      width: 28px;
      height: 28px;
      font-size: 13px;
      line-height: 1;
      color: color-mix(in srgb, var(--el-color-primary) 72%, var(--el-text-color-primary));
      background: color-mix(in srgb, var(--el-color-primary) 12%, transparent);
      border-radius: 50%;
    }

    span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 14px;
      font-weight: 650;
      white-space: nowrap;
    }

    small {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      font-size: 12px;
      color: var(--el-text-color-placeholder);
      white-space: nowrap;
    }
  }

  &__empty {
    margin: 16px 0 0;
    font-size: 14px;
    color: var(--el-text-color-placeholder);
  }

  &__fade-enter-active,
  &__fade-leave-active {
    transition: opacity 180ms ease;
  }

  &__fade-enter-from,
  &__fade-leave-to {
    opacity: 0;
  }

  &__slide-enter-active {
    transition:
      opacity 360ms cubic-bezier(0.16, 1, 0.3, 1),
      transform 360ms cubic-bezier(0.16, 1, 0.3, 1);

    &::before {
      animation: widgets-board-drawer-accent 520ms 70ms both;
    }

    .widgets-board__header,
    .widgets-board__input,
    .widgets-board__note,
    .widgets-board__hot-tabs,
    .widgets-board__hot,
    .widgets-board__empty {
      animation: widgets-board-drawer-item 460ms both;
    }

    .widgets-board__header {
      animation-delay: 70ms;
    }

    .widgets-board__input {
      animation-delay: 110ms;
    }

    .widgets-board__hot-tabs {
      animation-delay: 110ms;
    }

    .widgets-board__note,
    .widgets-board__hot,
    .widgets-board__empty {
      animation-delay: 150ms;
    }
  }

  &__slide-leave-active {
    transition:
      opacity 150ms ease-in,
      transform 150ms ease-in;
  }

  &__slide-enter-from,
  &__slide-leave-to {
    opacity: 0;
    transform: translateX(48px) scale(0.985);
  }
}

@media (width > 600px) {
  .widgets-board {
    &__close {
      &:hover,
      &:focus-visible {
        transform: rotate(90deg) scale(1.04);
      }
    }
  }
}

@media (prefers-reduced-motion: reduce) {
  .widgets-board {
    &__trigger,
    &__close,
    &__note,
    &__hot,
    &__fade-enter-active,
    &__fade-leave-active,
    &__slide-enter-active,
    &__slide-leave-active,
    &__slide-enter-active .widgets-board__header,
    &__slide-enter-active .widgets-board__input,
    &__slide-enter-active .widgets-board__note,
    &__slide-enter-active .widgets-board__hot-tabs,
    &__slide-enter-active .widgets-board__hot,
    &__slide-enter-active .widgets-board__empty {
      transition: none;
      animation: none;
    }
  }
}

@media (width <= 600px) {
  .widgets-board {
    &__scrim {
      backdrop-filter: blur(1px);
    }

    &__drawer {
      inset: 50% auto auto 50%;
      width: min(93vw, 430px);
      max-width: 93vw;
      max-height: min(78dvh, 640px);
      border-radius: 20px;
      box-shadow:
        0 0 15px 0 var(--le-bg-color-page-opacity-60),
        0 0 26px 4px color-mix(in srgb, var(--el-bg-color-page) 58%, transparent),
        0 18px 44px rgb(0 0 0 / 20%),
        0 0 0 1px color-mix(in srgb, var(--el-border-color) 42%, transparent);
      clip-path: inset(0 round 20px);
      transform: translate(-50%, -50%);
      transform-origin: center;
    }

    &__header {
      align-items: center;
      margin-bottom: 22px;
    }

    &__title {
      gap: 14px;

      img {
        display: block;
        width: 36px;
        height: 36px;
      }

      h2 {
        font-size: 25px;
      }
    }

    &__close {
      width: 44px;
      height: 44px;
      background: transparent !important;

      &:hover,
      &:focus-visible {
        background: color-mix(in srgb, var(--el-color-primary) 10%, transparent) !important;
      }
    }

    &__list {
      max-height: calc(min(78dvh, 640px) - 170px);

      &--hot {
        max-height: calc(min(78dvh, 640px) - 215px);
      }
    }

    &__slide-enter-from,
    &__slide-leave-to {
      transform: translate(-50%, calc(-50% + 32px)) scale(0.985);
    }
  }
}

@keyframes widgets-board-drawer-accent {
  0% {
    opacity: 0;
    transform: scaleY(0);
    animation-timing-function: cubic-bezier(0.34, 0, 0.14, 1);
  }

  20% {
    opacity: 0.32;
    transform: scaleY(0.18);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }

  70% {
    opacity: 0.9;
    transform: scaleY(1.04);
    animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  100% {
    opacity: 0.82;
    transform: scaleY(1);
  }
}

@keyframes widgets-board-drawer-item {
  0% {
    opacity: 0;
    transform: translateX(18px) scale(0.98);
    animation-timing-function: cubic-bezier(0.34, 0, 0.14, 1);
  }

  20% {
    opacity: 0;
    transform: translateX(22px) scale(0.97);
    animation-timing-function: cubic-bezier(0.16, 1, 0.3, 1);
  }

  72% {
    opacity: 1;
    transform: translateX(-2px) scale(1.005);
    animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1);
  }

  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}
</style>
