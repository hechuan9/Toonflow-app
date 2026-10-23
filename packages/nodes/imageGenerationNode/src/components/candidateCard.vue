<template>
  <article class="candidateCard" :class="{ selected, thumbnail }">
    <button class="candidateImage" type="button" :aria-label="thumbnail ? `查看候选 ${index + 1}` : `全屏查看候选 ${index + 1}`" :aria-pressed="thumbnail ? selected : undefined" :disabled="!url || failed" @click="emit('preview')">
      <img v-if="url && !failed" :src="url" :alt="`候选 ${index + 1}`" loading="lazy" draggable="false" @error="failed = true" />
      <span v-else class="placeholder">{{ failed ? '图片读取失败' : '正在读取图片…' }}</span>
    </button>
    <template v-if="!thumbnail">
      <div class="imageActions">
        <button type="button" :class="{ starred: item.starred }" :aria-label="`${item.starred ? '取消星标' : '星标'}候选 ${index + 1}`" :aria-pressed="!!item.starred" @click="emit('star')"><icon-star :size="19" :fill="item.starred ? 'currentColor' : 'none'" /></button>
        <button type="button" :disabled="disabled || !url || failed" :aria-label="`复制候选 ${index + 1} 到画布`" title="复制到画布" @click="emit('copy')"><icon-copy :size="18" /></button>
        <a :href="url || undefined" :download="item.url.split('/').at(-1)" :aria-label="`下载候选 ${index + 1}`" title="下载"><icon-download :size="19" /></a>
      </div>
      <button class="mainAction" :class="{ current: selected }" type="button" :disabled="disabled || selected || !url || failed" :aria-label="`${selected ? '当前主图' : '设为主图'}：候选 ${index + 1}`" @click="emit('select')">{{ selected ? '✓ 主图' : '设为主图' }}</button>
    </template>
  </article>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { IconStar, IconCopy, IconDownload } from "@tabler/icons-vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";

const props = defineProps<{ item: NodeMediaValue & { starred?: boolean }; index: number; selected: boolean; disabled?: boolean; thumbnail?: boolean }>();
const emit = defineEmits<{ select: []; preview: []; star: []; copy: [] }>();
const files = useNodeFiles();
const failed = ref(false);
watch(() => props.item.url, () => { failed.value = false; });
const url = files.useFileUrl(() => props.item, () => { failed.value = true; });
</script>

<style scoped lang="scss">
.candidateCard {
  position: relative;
  min-width: 0;
  overflow: hidden;
  border: 1px solid #ffffff38;
  border-radius: 16px;
  background: #171717;
  .candidateImage {
    display: block; width: 100%; height: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in;
    &:focus-visible { outline: 2px solid white; outline-offset: -3px; }
    img { display: block; width: 100%; height: 100%; object-fit: contain; }
    .placeholder { color: #aaa; }
  }
  .imageActions, .mainAction { position: absolute; top: 12px; opacity: 0; transition: opacity .15s; }
  &:hover, &:focus-within { .imageActions, .mainAction { opacity: 1; } }
  .imageActions {
    left: 12px; display: flex; align-items: center; padding: 3px; border-radius: 10px; background: #252525a8; backdrop-filter: blur(8px);
    button, a { display: grid; place-items: center; width: 30px; height: 30px; border: 0; color: white; background: transparent; cursor: pointer; }
    .starred { color: #ffda78; }
  }
  .mainAction {
    right: 12px; padding: 9px 12px; border: 0; border-radius: 10px; background: #252525a8; backdrop-filter: blur(8px); color: white; cursor: pointer; font: inherit; font-size: 12px;
    &.current { opacity: 1; background: #252525b8; cursor: default; }
  }
  &.thumbnail {
    border: 2px solid transparent; border-radius: 9px; opacity: .6;
    &.selected { border-color: white; opacity: 1; }
    .candidateImage { cursor: pointer; img { object-fit: cover; } }
  }
  @media (hover: none) { .imageActions, .mainAction { opacity: 1; } }
}
</style>
