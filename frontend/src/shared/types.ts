export type UnknownRecord = Record<string, unknown>;
export type XBlockElementLike = Element | { 0?: Element; length?: number; jquery?: string };

export interface XBlockRuntime {
  handlerUrl(
    element: XBlockElementLike,
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
  element: XBlockElementLike,
  data: unknown,
) => Props;
