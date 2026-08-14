/** Wire vocabulary for the Prompt Deepen Remote. */
/** Deepen request: the draft prompt text to optimize. */
export interface PromptDeepenRequest {
    readonly text: string;
}
/** Deepen result: the optimized prompt, or a user-facing error. */
export interface PromptDeepenResult {
    readonly ok: boolean;
    readonly text?: string;
    readonly error?: string;
}
//# sourceMappingURL=types.d.ts.map