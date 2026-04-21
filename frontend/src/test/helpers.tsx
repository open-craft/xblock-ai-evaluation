import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import { IntlProvider } from "react-intl";

function AllProviders({ children }: { children: React.ReactNode }) {
  return <IntlProvider locale="en" messages={{}}>{children}</IntlProvider>;
}

function customRender(ui: React.ReactElement, options?: Omit<RenderOptions, "wrapper">) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from "@testing-library/react";
export { customRender as render };
