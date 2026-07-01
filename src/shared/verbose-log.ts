import * as core from '@actions/core'

export const verboseLog = (message: string, verbose: boolean): void => {
  if (verbose) {
    core.info(`[VERBOSE] ${message}`)
  } else {
    core.debug(message)
  }
}
