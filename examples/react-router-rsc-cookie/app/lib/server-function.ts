"use server"

import { t } from "@palamedes/core/macro"

import { crossModuleServerFunctionMessage } from "./cross-module-helper"
import {
  asynchronousServerFunctionMessage,
  synchronousServerFunctionMessage,
} from "./server-helpers"

/** A real RSC Server Function invoked by the client proof component. */
export async function readLocalizedServerFunction(
  defaultParameter = t`Default parameter confirmed locale.`
) {
  return {
    asynchronous: await asynchronousServerFunctionMessage(),
    crossModule: crossModuleServerFunctionMessage(),
    defaultParameter,
    direct: t`Direct Server Function macro confirmed locale.`,
    synchronous: synchronousServerFunctionMessage(),
  }
}
