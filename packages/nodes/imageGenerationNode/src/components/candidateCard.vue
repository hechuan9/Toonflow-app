<template>
  <button class="candidateCard" :class="{ selected }" type="button" :aria-label="`查看候选 ${index + 1}`" :aria-pressed="selected" :disabled="!url || failed" @click="emit('preview')">
    <img v-if="url && !failed" :src="url" :alt="`候选 ${index + 1}`" loading="lazy" draggable="false" @error="failed = true" />
    <span v-else>{{ failed ? '图片读取失败' : '正在读取…' }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { useNodeFiles } from "@toonflow/nodes-scaffold/workspaceFiles";
import type { NodeMediaValue } from "@toonflow/nodes-scaffold/values";
const props = defineProps<{ item: NodeMediaValue; index: number; selected: boolean }>();
const emit = defineEmits<{ preview: [] }>();
const files = useNodeFiles();
const failed = ref(false);
watch(() => props.item.url, () => { failed.value = false; });
const url = files.useFileUrl(() => props.item, () => { failed.value = true; });
</script>

<style scoped lang="scss">
.candidateCard {
  display: block; min-width: 0; overflow: hidden; padding: 0; border: 2px solid transparent; border-radius: 9px; background: #171717; color: #aaa; opacity: .6; cursor: pointer;
  &.selected { border-color: white; opacity: 1; }
  &:focus-visible { outline: 2px solid white; outline-offset: 2px; }
  img { display: block; width: 100%; height: 100%; object-fit: cover; }
}
</style>
