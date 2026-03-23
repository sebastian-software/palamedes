import { contextStorage } from "hono/context-storage"
import adapter from "waku/adapters/default"
import { Slot } from "waku/minimal/client"
import App from "./components/App"

export default adapter(
  {
    handleRequest: async (input, { renderRsc, renderHtml }) => {
      if (input.type === "function") {
        return renderRsc({
          _value: await input.fn(...input.args),
        })
      }

      if (input.type === "custom" && input.pathname === "/set-locale" && input.req.method === "POST") {
        const formData = await input.req.formData()
        const locale = String(formData.get("locale") ?? "en")
        const location = new URL("/", input.req.url)

        return new Response(null, {
          status: 303,
          headers: {
            Location: location.toString(),
            "Set-Cookie": `locale=${locale}; Path=/; Max-Age=31536000; SameSite=Lax`,
          },
        })
      }

      if (input.type === "component") {
        return renderRsc({ App: <App /> })
      }

      if ((input.type === "action" || input.type === "custom") && input.pathname === "/") {
        const formState = input.type === "action" ? await input.fn() : undefined
        const response = await renderHtml(
          await renderRsc({ App: <App /> }),
          <Slot id="App" />,
          {
            formState,
            rscPath: "",
          },
        )

        if (input.type === "custom") {
          return response
        }

        return response
      }
    },
    handleBuild: async () => {},
  },
  {
    middlewareFns: [contextStorage],
    middlewareModules: import.meta.glob("./middleware/*.ts"),
  },
)
