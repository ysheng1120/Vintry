/**
 * The one import of vite-plugin-pwa's virtual module. It exists only inside the Vite build, so
 * tests mock this file instead: vi.mock("./pwaRegister", ...).
 */
export { useRegisterSW } from "virtual:pwa-register/react";
