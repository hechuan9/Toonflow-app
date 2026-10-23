<template>
  <section v-if="visible" class="modelStatus" aria-label="本地模型与任务状态">
    <button class="statusToggle" type="button" :aria-expanded="expanded" aria-controls="modelStatusDetails" @click="expanded = !expanded">
      <span class="statusDot" :class="{ disconnected: connectionError }" />
      <strong>{{ connectionError ? "模型状态连接中断" : snapshot?.phase || "正在连接模型状态" }}</strong>
      <span class="modelName">{{ snapshot?.residentModel || "无驻留模型" }}</span>
      <span class="queueCount">运行 {{ runningCount }} · 排队 {{ queuedCount }}</span>
      <span class="expandLabel">{{ expanded ? "收起" : "任务与日志" }} {{ expanded ? "▾" : "▴" }}</span>
    </button>
    <div v-if="expanded" id="modelStatusDetails" class="statusDetails" @keydown.esc="expanded = false">
      <p v-if="connectionError" class="connectionError" role="status">连接中断，正在重试。以下是最后一次获取的状态，可能已过期。</p>
      <p v-if="snapshot?.idleExpiresAt" class="ttlHint">空闲模型预计于 {{ formatTime(snapshot.idleExpiresAt) }} 释放（TTL {{ snapshot.ttlSeconds }} 秒）</p>
      <div class="detailColumns">
        <section class="taskSection" aria-label="任务进度">
          <h2>任务进度</h2>
          <ul class="taskList">
            <li v-for="task in orderedTasks" :key="task.id" class="taskRow">
              <div class="taskTitle"><strong>{{ task.label }}</strong><span>{{ stateLabels[task.state] }}</span></div>
              <div class="taskMeta">{{ task.model }} · {{ task.stage }}</div>
              <div v-if="task.state === 'running'" class="taskProgress">
                <progress :value="task.progress ?? undefined" max="100" :aria-label="`${task.label}：当前步骤进度`" />
                <span>{{ task.progress === null ? "当前步骤进度未知" : `当前步骤 ${Math.round(task.progress)}%` }}</span>
              </div>
              <p v-if="task.error" class="taskError">{{ task.error }}</p>
            </li>
          </ul>
        </section>
        <section class="logSection" aria-label="模型运行日志">
          <h2>运行日志 <small>最新在前</small></h2>
          <ul class="logList"><li v-for="(log, index) in recentLogs" :key="`${log.time}-${index}`"><time>{{ formatTime(log.time) }}</time><span>{{ log.message }}</span></li></ul>
        </section>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import axios from "axios";

type TaskState = "queued" | "running" | "completed" | "failed" | "cancelled";
interface QueueTask {
  id: string;
  model: string;
  label: string;
  state: TaskState;
  stage: string;
  progress: number | null;
  createdAt: number;
  error?: string;
}
interface QueueSnapshot {
  enabled: boolean;
  residentModel: string | null;
  phase: string;
  idleExpiresAt: number | null;
  ttlSeconds: number;
  tasks: QueueTask[];
  logs: { time: number; message: string }[];
}
const emit = defineEmits<{ visible: [value: boolean] }>();
const snapshot = shallowRef<QueueSnapshot>();
const connectionError = ref(false);
const expanded = ref(false);
const visible = computed(() => snapshot.value?.enabled ?? connectionError.value);
const runningCount = computed(() => snapshot.value?.tasks.filter(task => task.state === "running").length ?? 0);
const queuedCount = computed(() => snapshot.value?.tasks.filter(task => task.state === "queued").length ?? 0);
const stateLabels: Record<TaskState, string> = { queued: "排队中", running: "处理中", completed: "已完成", failed: "失败", cancelled: "已取消" };
const stateOrder: Record<TaskState, number> = { running: 0, queued: 1, failed: 2, completed: 3, cancelled: 4 };
const orderedTasks = computed(() => [...snapshot.value?.tasks ?? []].sort((a, b) => stateOrder[a.state] - stateOrder[b.state] || b.createdAt - a.createdAt));
const recentLogs = computed(() => [...snapshot.value?.logs ?? []].reverse());
watch(visible, value => emit("visible", value), { immediate: true });
function formatTime(time: number) {
  return new Date(time).toLocaleTimeString("zh-CN", { hour12: false });
}
const controller = new AbortController();
let timer: ReturnType<typeof setTimeout> | undefined;
async function refreshStatus() {
  try {
    const { data } = await axios.get<{ code: number; data: QueueSnapshot }>("/api/modelQueue/status", { signal: controller.signal, timeout: 8000 });
    if (data.code !== 200) throw new Error("模型状态获取失败");
    snapshot.value = data.data;
    connectionError.value = false;
  } catch {
    if (!controller.signal.aborted) connectionError.value = true;
  } finally {
    if (!controller.signal.aborted) timer = setTimeout(refreshStatus, 2000);
  }
}
onMounted(refreshStatus);
onBeforeUnmount(() => {
  controller.abort();
  clearTimeout(timer);
});
</script>

<style scoped lang="scss">
.modelStatus {
  position: fixed;
  inset: auto 0 0;
  z-index: 100;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-overlay);
  border-top: 1px solid var(--el-border-color);
  font-size: 12px;

  .statusToggle {
    width: 100%;
    height: 38px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
    .statusDot { width: 7px; height: 7px; flex-shrink: 0; border-radius: 50%; background: var(--el-color-primary); &.disconnected { background: var(--el-color-danger); } }
    strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .modelName { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--el-text-color-secondary); }
    .queueCount { margin-left: auto; white-space: nowrap; }
    .expandLabel { white-space: nowrap; }
  }
  .statusDetails {
    position: absolute;
    bottom: 100%;
    width: 100%;
    height: min(440px, 65dvh);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--el-bg-color-overlay);
    border-top: 1px solid var(--el-border-color);
    box-shadow: 0 -6px 20px #00000012;
    padding: 12px 16px;
    .connectionError, .ttlHint { margin: 0 0 10px; }
    .connectionError { color: var(--el-color-danger); }
    .ttlHint { color: var(--el-text-color-secondary); }
    .detailColumns {
      display: grid;
      flex: 1;
      min-height: 0;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: minmax(0, 1fr);
      gap: 24px;
      > section { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
      h2 { font-size: 13px; margin: 0 0 10px; small { font-weight: normal; color: var(--el-text-color-secondary); } }
      ul { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; scrollbar-gutter: stable; list-style: none; padding: 0; margin: 0; }
      .taskList .taskRow {
        padding: 9px 0;
        border-bottom: 1px solid var(--el-border-color-lighter);
        overflow-wrap: anywhere;
        .taskTitle { display: flex; justify-content: space-between; gap: 12px; span { white-space: nowrap; } }
        .taskMeta { color: var(--el-text-color-secondary); margin: 5px 0; }
        .taskProgress { display: flex; align-items: center; gap: 10px; progress { width: 100%; min-width: 30px; height: 7px; accent-color: var(--el-color-primary); } span { white-space: nowrap; } }
        .taskError { margin: 5px 0 0; color: var(--el-color-danger); }
      }
      .logList li { display: flex; gap: 10px; padding: 4px 0; line-height: 1.5; time { color: var(--el-text-color-secondary); flex-shrink: 0; } span { white-space: pre-wrap; overflow-wrap: anywhere; } }
    }
  }
  @media (max-width: 640px) {
    .statusToggle { gap: 7px; padding: 0 8px; .modelName { display: none; } .expandLabel { font-size: 11px; } }
    .statusDetails .detailColumns { grid-template-columns: 1fr; grid-template-rows: repeat(2, minmax(0, 1fr)); gap: 18px; }
  }
}
</style>
