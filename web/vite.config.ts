import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		port: 5173,
		// Reachable from outside the container when run under docker-compose.dev.yml.
		host: true,
		// Bind mounts do not deliver filesystem events reliably on macOS/Windows,
		// so fall back to polling when the dev container asks for it.
		watch: process.env.CHOKIDAR_USEPOLLING
			? { usePolling: true, interval: 300 }
			: undefined
	}
});
