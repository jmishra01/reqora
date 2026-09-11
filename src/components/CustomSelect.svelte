<script lang="ts" generics="T extends string">
  import { onDestroy, onMount, tick } from 'svelte';
  import { ChevronDown } from '@lucide/svelte';

  type SelectOption<T> = { value: T; label: string; disabled?: boolean };

  export let value: T;
  export let options: SelectOption<T>[] = [];
  export let onChange: (value: T) => void = () => {};
  export let ariaLabel = '';
  export let disabled = false;
  export let optionClass: (value: T) => string = () => '';
  let className = '';
  export { className as class };

  let open = false;
  let root: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let panel: HTMLUListElement;
  let highlightedIndex = -1;
  let suppressToggleUntil = 0;

  $: selectedOption = options.find((option) => option.value === value) ?? options[0];

  async function openPanel() {
    if (disabled || !options.length) return;
    highlightedIndex = Math.max(0, options.findIndex((option) => option.value === value));
    open = true;
    await tick();
    panel?.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' });
  }

  function closePanel(focusTrigger = false) {
    open = false;
    if (focusTrigger) trigger?.focus();
  }

  function toggle() {
    // Some browsers/webviews replay a click on the trigger right after a selection closes
    // the panel (the mouseup lands after the option's DOM node is gone); ignore that echo.
    if (Date.now() < suppressToggleUntil) return;
    if (open) closePanel();
    else openPanel();
  }

  function choose(option: SelectOption<T>) {
    if (option.disabled) return;
    const changed = option.value !== value;
    value = option.value;
    closePanel(true);
    suppressToggleUntil = Date.now() + 250;
    if (changed) onChange(value);
  }

  async function moveHighlight(next: number) {
    highlightedIndex = Math.min(options.length - 1, Math.max(0, next));
    await tick();
    panel?.querySelector('.highlighted')?.scrollIntoView({ block: 'nearest' });
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (disabled) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      openPanel();
      return;
    }
    if (!open) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); moveHighlight(highlightedIndex + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); moveHighlight(highlightedIndex - 1); }
    else if (event.key === 'Home') { event.preventDefault(); moveHighlight(0); }
    else if (event.key === 'End') { event.preventDefault(); moveHighlight(options.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const option = options[highlightedIndex];
      if (option) choose(option);
    } else if (event.key === 'Escape') { event.preventDefault(); closePanel(true); }
    else if (event.key === 'Tab') closePanel();
  }

  function handleWindowMousedown(event: MouseEvent) {
    if (open && root && !root.contains(event.target as Node)) closePanel();
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') closePanel(true);
  }

  onMount(() => {
    window.addEventListener('mousedown', handleWindowMousedown);
    window.addEventListener('keydown', handleWindowKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('mousedown', handleWindowMousedown);
    window.removeEventListener('keydown', handleWindowKeydown);
  });
</script>

<div class="custom-select {className}" class:disabled bind:this={root}>
  <button
    type="button"
    class="custom-select-trigger {optionClass(value)}"
    aria-haspopup="listbox"
    aria-expanded={open}
    aria-label={ariaLabel}
    {disabled}
    bind:this={trigger}
    on:click={toggle}
    on:keydown={handleTriggerKeydown}
  >
    <span class="custom-select-label">{selectedOption?.label ?? ''}</span>
    <ChevronDown size={13} class="custom-select-caret" />
  </button>
  <ul class="custom-select-panel" role="listbox" aria-label={ariaLabel} bind:this={panel} hidden={!open}>
    {#each options as option, index (option.value)}
      <li
        role="option"
        aria-selected={option.value === value}
        aria-disabled={option.disabled}
        class="custom-select-option {optionClass(option.value)}"
        class:selected={option.value === value}
        class:highlighted={index === highlightedIndex}
        on:mouseenter={() => highlightedIndex = index}
        on:click={() => choose(option)}
        on:keydown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(option); } }}
      >{option.label}</li>
    {/each}
  </ul>
</div>

<style>
  .custom-select { position: relative; display: inline-flex; min-width: 0; }
  .custom-select.disabled { opacity: .5; pointer-events: none; }
  .custom-select-trigger {
    all: unset;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    min-width: 0;
    height: 31px;
    padding: 0 9px;
    border: 1px solid var(--line);
    border-radius: 5px;
    background: var(--panel);
    color: var(--text);
    font-family: inherit;
    font-size: 9px;
    cursor: pointer;
  }
  .custom-select-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  .custom-select-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; }
  :global(.custom-select-caret) { flex: 0 0 auto; color: var(--muted-2); }
  .custom-select-panel {
    position: absolute;
    z-index: 30;
    top: calc(100% + 4px);
    left: 0;
    min-width: 100%;
    width: max-content;
    max-width: 320px;
    max-height: 260px;
    overflow-y: auto;
    margin: 0;
    padding: 4px;
    list-style: none;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--panel-2);
    box-shadow: 0 18px 45px rgba(0,0,0,.35);
  }
  .custom-select-option {
    display: flex;
    align-items: center;
    min-height: 27px;
    padding: 5px 9px;
    border-radius: 5px;
    color: var(--text);
    font-size: 9.5px;
    white-space: nowrap;
    cursor: pointer;
  }
  .custom-select-option:hover, .custom-select-option.highlighted { background: var(--panel-3); }
  .custom-select-option.selected { background: var(--accent-soft); font-weight: 550; }
  .custom-select-option.selected.highlighted { background: var(--panel-3); }
  .custom-select-option[aria-disabled="true"] { opacity: .4; pointer-events: none; }
</style>
