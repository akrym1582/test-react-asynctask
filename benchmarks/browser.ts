import { measureForm } from "./form";
declare global {
  interface Window {
    measureForm: typeof measureForm;
  }
}
window.measureForm = measureForm;
