<template>
  <article class="candidateCard" :class="{ selected }">
    <button class="candidateSelect" type="button" :aria-label="`选择候选 ${index + 1}`" :aria-pressed="selected" :disabled="disabled || !url || failed" @click="emit('select')">
      <img v-if="url && !failed" :src="url" :alt="`候选 ${index + 1}`" loading="lazy" draggable="false" @error="failed = true" />
      <span v-else class="placeholder">{{ failed ? '图片读取失败' : '正在读取图片…' }}</span>
      <span v-if="selected" class="selectedBadge">✓ 已选为输出</span>
    </button>
    <div class="candidateFooter"><span>候选 {{ index + 1 }}</span><button type="button" :disabled="!url || failed" :aria-label="`放大候选 ${index + 1}`" @click="emit('preview')">放大</button></div>
  </article>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ item: NodeMediaValue; index: number; selected: boolean; disabled?: boolean }>();
const emit = defineEmits<{ select: []; preview: [] }>();
const files = useNodeFiles();
const failed = ref(false);
watch(() => props.item.url, () => { failed.value = false; });
const url = files.useFileUrl(() => props.item, () => { failed.value = true; });
</script>

<style scoped lang="scss">
.candidateCard {
  min-width: 0;
  overflow: hidden;
  border: 2px solid var(--el-border-color-light);
  border-radius: 8px;
  background: var(--el-bg-color);
  &.selected { border-color: var(--el-color-primary); }
  .candidateSelect {
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 16 / 9;
    padding: 0;
    border: 0;
    background: var(--el-fill-color-light);
    cursor: pointer;
    &:focus-visible { outline: 3px solid var(--el-color-primary); outline-offset: -3px; }
    &:disabled { cursor: default; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .placeholder { color: var(--el-text-color-secondary); }
    .selectedBadge { position: absolute; right: 8px; top: 8px; padding: 5px 8px; border-radius: 5px; color: white; background: var(--el-color-primary); font-size: 12px; }
  }
  .candidateFooter {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 7px 10px;
    font-size: 12px;
    color: var(--el-text-color-secondary);
    button { padding: 3px 7px; border: 0; border-radius: 4px; background: var(--el-fill-color-light); color: var(--el-text-color-primary); cursor: pointer; }
  }
}
</style>
