import * as path from 'path'
import {mkdtemp, rm} from 'fs/promises'
import * as core from '@actions/core'
import {Minimatch} from 'minimatch'
import artifactClient, {UploadArtifactOptions} from '@actions/artifact'
import {getInputs} from './input-helper.js'
import {uploadArtifact} from '../shared/upload-artifact.js'
import {findFilesToUpload} from '../shared/search.js'
import {verboseLog} from '../shared/verbose-log.js'

const PARALLEL_DOWNLOADS = 5

export const chunk = <T>(arr: T[], n: number): T[][] =>
  arr.reduce((acc, cur, i) => {
    const index = Math.floor(i / n)
    acc[index] = [...(acc[index] || []), cur]
    return acc
  }, [] as T[][])

export async function run(): Promise<void> {
  const inputs = getInputs()

  verboseLog(
    `Starting merge-artifact action with inputs: ${JSON.stringify(
      {
        name: inputs.name,
        pattern: inputs.pattern,
        separateDirectories: inputs.separateDirectories,
        retentionDays: inputs.retentionDays ?? '<default>',
        compressionLevel: inputs.compressionLevel ?? '<default>',
        deleteMerged: inputs.deleteMerged,
        includeHiddenFiles: inputs.includeHiddenFiles,
        verbose: inputs.verbose
      },
      null,
      2
    )}`,
    inputs.verbose
  )

  const tmpDir = await mkdtemp('merge-artifact')
  verboseLog(`Created temporary directory for merge: ${tmpDir}`, inputs.verbose)

  verboseLog(`Listing latest artifacts from current workflow run`, inputs.verbose)
  const listArtifactResponse = await artifactClient.listArtifacts({
    latest: true,
    verbose: inputs.verbose
  })
  verboseLog(
    `Retrieved ${listArtifactResponse.artifacts.length} artifact(s) from API`,
    inputs.verbose
  )

  const matcher = new Minimatch(inputs.pattern)
  const artifacts = listArtifactResponse.artifacts.filter(artifact =>
    matcher.match(artifact.name)
  )
  core.debug(
    `Filtered from ${listArtifactResponse.artifacts.length} to ${artifacts.length} artifacts`
  )
  verboseLog(
    `Pattern '${inputs.pattern}' matched ${artifacts.length} artifact(s)`,
    inputs.verbose
  )

  if (artifacts.length === 0) {
    verboseLog(
      `No artifacts matched pattern '${inputs.pattern}'`,
      inputs.verbose
    )
    throw new Error(`No artifacts found matching pattern '${inputs.pattern}'`)
  }

  core.info(`Preparing to download the following artifacts:`)
  artifacts.forEach(artifact => {
    core.info(`- ${artifact.name} (ID: ${artifact.id}, Size: ${artifact.size})`)
    verboseLog(
      `Will download artifact '${artifact.name}' (ID: ${artifact.id}, size: ${artifact.size}, digest: ${artifact.digest ?? '<none>'})`,
      inputs.verbose
    )
  })

  const downloadPromises = artifacts.map(artifact => {
    const downloadPath = inputs.separateDirectories
      ? path.join(tmpDir, artifact.name)
      : tmpDir
    verboseLog(
      `Artifact '${artifact.name}' download path: ${downloadPath}`,
      inputs.verbose
    )
    return artifactClient.downloadArtifact(artifact.id, {
      path: downloadPath,
      verbose: inputs.verbose
    })
  })

  const chunkedPromises = chunk(downloadPromises, PARALLEL_DOWNLOADS)
  verboseLog(
    `Downloading ${artifacts.length} artifact(s) in ${chunkedPromises.length} chunk(s) (parallelism: ${PARALLEL_DOWNLOADS})`,
    inputs.verbose
  )
  for (let chunkIndex = 0; chunkIndex < chunkedPromises.length; chunkIndex++) {
    const currentChunk = chunkedPromises[chunkIndex]
    verboseLog(
      `Processing download chunk ${chunkIndex + 1}/${chunkedPromises.length} (${currentChunk.length} artifact(s))`,
      inputs.verbose
    )
    await Promise.all(currentChunk)
    verboseLog(`Download chunk ${chunkIndex + 1} completed`, inputs.verbose)
  }

  const options: UploadArtifactOptions = {}
  if (inputs.retentionDays) {
    options.retentionDays = inputs.retentionDays
  }

  if (typeof inputs.compressionLevel !== 'undefined') {
    options.compressionLevel = inputs.compressionLevel
  }

  options.verbose = inputs.verbose

  verboseLog(
    `Scanning merged content in '${tmpDir}' for upload as '${inputs.name}'`,
    inputs.verbose
  )
  const searchResult = await findFilesToUpload(
    tmpDir,
    inputs.includeHiddenFiles,
    inputs.verbose
  )

  verboseLog(`Uploading merged artifact`, inputs.verbose)
  await uploadArtifact(
    inputs.name,
    searchResult.filesToUpload,
    searchResult.rootDirectory,
    options,
    inputs.verbose
  )

  core.info(
    `The ${artifacts.length} artifact(s) have been successfully merged!`
  )
  verboseLog(`Merge upload completed successfully`, inputs.verbose)

  if (inputs.deleteMerged) {
    verboseLog(
      `delete-merged enabled, deleting ${artifacts.length} source artifact(s)`,
      inputs.verbose
    )
    const deletePromises = artifacts.map(artifact =>
      artifactClient.deleteArtifact(artifact.name)
    )
    await Promise.all(deletePromises)
    core.info(`The ${artifacts.length} artifact(s) have been deleted`)
    verboseLog(`Source artifacts deleted`, inputs.verbose)
  }

  try {
    await rm(tmpDir, {recursive: true})
    verboseLog(`Removed temporary directory ${tmpDir}`, inputs.verbose)
  } catch (error) {
    core.warning(
      `Unable to remove temporary directory: ${(error as Error).message}`
    )
    verboseLog(
      `Failed to remove temporary directory: ${(error as Error).message}`,
      inputs.verbose
    )
  }

  verboseLog(`Merge action completed successfully`, inputs.verbose)
}
