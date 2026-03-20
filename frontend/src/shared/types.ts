export type UnknownRecord = Record<string, unknown>;

export interface XBlockRuntime {
  handlerUrl(
    element: Element,
    handlerName: string,
    suffix?: string,
    query?: string,
  ): string;
  notify?(name: string, payload?: UnknownRecord): void;
}

export interface SharedPayload<
  HandlerUrls extends UnknownRecord = UnknownRecord,
  InitialState extends UnknownRecord = UnknownRecord,
  Meta extends UnknownRecord = UnknownRecord,
> {
  view: string;
  handler_urls: HandlerUrls;
  initial_state: InitialState;
  meta: Meta;
}

export type XBlockPropsFactory<Props> = (
  runtime: XBlockRuntime,
  element: Element,
  data: unknown,
) => Props;
