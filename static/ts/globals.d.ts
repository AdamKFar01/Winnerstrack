// Chart.js is loaded as a global via CDN <script> tag in index.html,
// not imported as a module, so it needs an ambient declaration.
declare const Chart: any;

// Transitional shims for the JS-to-TS migration. The original code calls
// getElementById()/querySelector() and reads input-only properties
// (.value, .checked, ...) off the generic HTMLElement/Element/EventTarget
// types. These interface merges make that legal without touching app code.
// Phase 2 replaces them with proper HTMLInputElement casts, then this
// block gets deleted.
interface Element {
    value: any;
    src: string;
    dataset: DOMStringMap;
    style: CSSStyleDeclaration;
    checked: boolean;
}

interface HTMLElement {
    value: any;
    checked: boolean;
    required: boolean;
    disabled: boolean;
    src: string;
    options: HTMLOptionsCollection;
    selectedIndex: number;
    selectedOptions: HTMLCollectionOf<HTMLOptionElement>;
    reset(): void;
    submit(): void;
    getContext(contextId: string, options?: any): any;
}

interface EventTarget {
    value: any;
    checked: boolean;
    dataset: DOMStringMap;
    options: HTMLOptionsCollection;
    selectedIndex: number;
    closest(selector: string): Element | null;
    classList: DOMTokenList;
    tagName: string;
    querySelector(selector: string): Element | null;
    reset(): void;
}
