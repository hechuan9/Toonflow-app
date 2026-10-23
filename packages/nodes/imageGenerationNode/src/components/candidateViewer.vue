<template>
  <el-dialog :modelValue="true" fullscreen appendToBody destroyOnClose class="candidateViewer" :showClose="false" @close="emit('close')">
    <template #header>
      <div class="viewerHeader">
        <span>{{ previewIndex + 1 }} / {{ items.length }}</span>
        <button :aria-pressed="starredOnly" @click="starredOnly = !starredOnly">{{ starredOnly ? '★ 仅看星标' : '☆ 星标筛选' }}</button>
        <button v-if="current" :aria-pressed="!!current.starred" @click="emit('star', current)">{{ current.starred ? '★ 已星标' : '☆ 星标' }}</button>
        <button v-if="current" :disabled="disabled || current.url === mainUrl" @click="emit('select', current)">{{ current.url === mainUrl ? '✓ 主图' : '设为主图' }}</button>
        <a v-if="current && url && !failed" :href="url" :download="current.url.split('/').at(-1)" aria-label="下载当前候选">下载</a>
        <button v-if="current" :disabled="!canRemove" aria-label="删除当前候选" title="删除候选（可撤销）" @click="emit('remove', current)">删除</button>
        <button v-if="canRestore" @click="emit('restore')">撤销删除</button>
        <button class="closeViewer" aria-label="关闭全屏查看" @click="emit('close')">×</button>
      </div>
    </template>
    <div class="viewerBody nodrag nopan nowheel" @pointerdown.stop @keydown.left.prevent="move(-1)" @keydown.right.prevent="move(1)">
      <div class="mainPreview">
        <button class="previous" aria-label="上一张候选" :disabled="visibleItems.length < 2" @click="move(-1)">‹</button>
        <img v-if="url && !failed" :src="url" :alt="`全屏候选 ${previewIndex + 1}`" @error="failed = true" />
        <span v-else>{{ current ? failed ? '图片读取失败' : '正在读取图片…' : '还没有星标图片' }}</span>
        <button class="next" aria-label="下一张候选" :disabled="visibleItems.length < 2" @click="move(1)">›</button>
      </div>
      <div class="thumbnailStrip" aria-label="候选缩略图">
        <candidateCard v-for="item in visibleItems" :key="item.url" :item="item" :index="items.indexOf(item)" :selected="current?.url === item.url" @preview="previewIndex = items.indexOf(item)" />
      </div>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ElDialog } from "element-plus";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";
import candidateCard from "./candidateCard.vue";
const props = defineProps<{ items: (NodeMediaValue & { starred?: boolean })[]; initialIndex: number; mainUrl?: string; disabled?: boolean; canRemove?: boolean; canRestore?: boolean }>();
const emit = defineEmits<{ close: []; select: [item: NodeMediaValue]; star: [item: NodeMediaValue]; remove: [item: NodeMediaValue]; restore: [] }>();
const previewIndex = ref(props.initialIndex);
const starredOnly = ref(false);
const visibleItems = computed(() => props.items.filter(item => !starredOnly.value || item.starred));
const current = computed(() => props.items[previewIndex.value]);
const failed = ref(false);
const files = useNodeFiles();
const url = files.useFileUrl(current, () => { failed.value = true; });
watch(current, () => { failed.value = false; });
watch(visibleItems, items => {
  if (!items.some(item => item.url === current.value?.url)) {
    const next = props.items[Math.min(Math.max(previewIndex.value, 0), props.items.length - 1)];
    previewIndex.value = next && items.includes(next) ? props.items.indexOf(next) : items.length ? props.items.indexOf(items[0]!) : -1;
  }
});
function move(direction: number) {
  const items = visibleItems.value;
  if (!items.length) return;
  const index = items.findIndex(item => item.url === current.value?.url);
  previewIndex.value = props.items.indexOf(items[(index + direction + items.length) % items.length]!);
}
</script>

<style lang="scss">
.candidateViewer.el-dialog {
  display: flex; flex-direction: column; margin: 0; padding: 16px 24px 20px; background: #101010; color: #eee;
  .el-dialog__header { padding: 0 0 12px; }
  .el-dialog__body { flex: 1; min-height: 0; padding: 0; }
  .viewerHeader {
    display: flex; flex-wrap: wrap; align-items: center; gap: 12px; color: #aaa;
    button, a { text-decoration: none; font: inherit; font-size: 13px; border: 0; border-radius: 8px; padding: 9px 12px; color: #eee; background: #252525; cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
    .closeViewer { margin-left: auto; font-size: 24px; line-height: 20px; }
  }
  .viewerBody { display: flex; flex-direction: column; height: 100%; gap: 16px; }
  .mainPreview {
    position: relative; display: grid; place-items: center; flex: 1; min-height: 0;
    img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: contain; }
    button { position: absolute; z-index: 1; top: 50%; width: 38px; height: 48px; border: 0; border-radius: 10px; background: #2229; color: white; font-size: 30px; cursor: pointer; }
    .previous { left: 8px; } .next { right: 8px; }
    button:disabled { visibility: hidden; }
  }
  .thumbnailStrip {
    display: flex; align-items: center; gap: 10px; overflow-x: auto; flex-shrink: 0; max-width: 100%; margin: 0 auto; padding: 3px;
    .candidateCard { flex: 0 0 76px; width: 76px; height: 60px; }
  }
}
</style>
