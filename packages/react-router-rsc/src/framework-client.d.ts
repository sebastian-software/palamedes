// React Router supplies this side-effect entry as TSX for the host bundler.
// It has no value exports consumed by the adapter.
declare module "@react-router/dev/config/default-rsc-entries/entry.client";

// React Router's generated client entry imports this Vite virtual module for
// development HMR. TypeDoc analyzes that generated entry as part of the site
// build, where the React Router Vite plugin is not running to provide the
// ambient module declaration.
declare module "virtual:react-router/unstable_rsc/inject-hmr-runtime";
