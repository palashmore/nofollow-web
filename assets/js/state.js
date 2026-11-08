// Shared mutable state, kept out of app.js so views can import it without a circular dependency.
export const store = { data: null, logs: [], selection: new Set(), reqSelection: new Set(), view: null };
export const hooks = { refresh: async () => {}, route: () => {} };
