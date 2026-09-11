import { mount } from 'svelte';
import App from './App.svelte';
import './styles.css';

document.addEventListener('contextmenu', (event) => {
  const target = event.target as HTMLElement | null;
  if (target?.closest('input, textarea, [contenteditable="true"]')) return;
  event.preventDefault();
});

mount(App, { target: document.getElementById('app')! });

