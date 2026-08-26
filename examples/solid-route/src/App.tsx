/// <reference types="filesystem-routing/types" />

import { Loading } from "solid-js"
import { createRouter } from "@solidjs/router"
import { fileRoutes } from "@solidjs/router/fs"
import { pageRoutes } from "virtual:file-routes"
import "@palamedes/example-ui/styles.css"

const Router = createRouter({ routes: fileRoutes(pageRoutes) })

export default function App() {
  return <Router>{(props) => <Loading>{props.children}</Loading>}</Router>
}
