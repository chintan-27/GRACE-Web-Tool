/** @type {import('next').NextConfig} */
const nextConfig = {
	reactStrictMode: true,
	webpack: (config) => {
		config.resolve = {
			...config.resolve,
			fallback: {
				fs: false,
				// Add other fallbacks if necessary
			},
		};
		// Enable WebAssembly support
		config.experiments = {
			asyncWebAssembly: true, // Enable async WebAssembly
			syncWebAssembly: true,  // Enable sync WebAssembly if needed
			layers: true, // Enable layers experiment
		};
		return config;
	},
	eslint: {
		ignoreDuringBuilds: true, // ✅ Disables ESLint during builds
	},
};

export default nextConfig;
