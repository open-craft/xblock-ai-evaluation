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
  HandlerUrls = UnknownRecord,
  InitialState = UnknownRecord,
  Meta = UnknownRecord,
> {
  view: string;
  handler_urls: HandlerUrls;
  initial_state: InitialState;
  meta: Meta;
  mfe_config_api: string;
  style_urls: string[];
}

export type XBlockPropsFactory<Props> = (
  runtime: XBlockRuntime,
  element: XBlockElementLike,
  data: unknown,
) => Props;

export interface StudioChoice {
  display_name?: string;
  value?: string;
}

export interface StudioFieldMetadata {
  choices?: StudioChoice[];
  default?: unknown;
  display_name?: string;
  help?: string;
}
