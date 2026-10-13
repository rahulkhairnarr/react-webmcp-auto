export {};
declare global {
  interface Document {
    modelContext?: {
      getTools(): Promise<
        { name: string; description: string; inputSchema?: object; annotations?: object }[]
      >;
      executeTool(tool: unknown, input?: object): Promise<string>;
      addEventListener(type: string, cb: () => void): void;
    };
  }
  interface Window {
    __toolchanges?: number;
  }
}
