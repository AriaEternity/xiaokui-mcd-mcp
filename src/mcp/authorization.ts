// 可选连接层端口；OAuth不改变工具实现或扩展数据访问能力。
export interface McpAuthorization {
  readonly challenge: string;
  readonly securitySchemes: { type: "oauth2"; scopes: string[] }[];
  authorize(header: string | undefined): Promise<void>;
}
