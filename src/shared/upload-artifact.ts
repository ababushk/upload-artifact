import * as core from '@actions/core'
import * as github from '@actions/github'
import artifact, {UploadArtifactOptions} from '@actions/artifact'
import {verboseLog} from './verbose-log.js'

export async function uploadArtifact(
  artifactName: string,
  filesToUpload: string[],
  rootDirectory: string,
  options: UploadArtifactOptions,
  verbose: boolean
) {
  verboseLog(
    `Calling artifact.uploadArtifact with name '${artifactName}', ${filesToUpload.length} file(s), root '${rootDirectory}', options: ${JSON.stringify(options)}`,
    verbose
  )
  if (verbose && filesToUpload.length <= 20) {
    verboseLog(`Files to upload: ${JSON.stringify(filesToUpload)}`, verbose)
  } else if (verbose) {
    verboseLog(
      `First 10 files to upload: ${JSON.stringify(filesToUpload.slice(0, 10))} ... (${filesToUpload.length} total)`,
      verbose
    )
  }

  const uploadResponse = await artifact.uploadArtifact(
    artifactName,
    filesToUpload,
    rootDirectory,
    {...options, verbose}
  )

  verboseLog(
    `Upload API response - ID: ${uploadResponse.id}, size: ${uploadResponse.size} bytes, digest: ${uploadResponse.digest ?? '<none>'}`,
    verbose
  )

  core.info(
    `Artifact ${artifactName} has been successfully uploaded! Final size is ${uploadResponse.size} bytes. Artifact ID is ${uploadResponse.id}`
  )
  core.setOutput('artifact-id', uploadResponse.id)
  core.setOutput('artifact-digest', uploadResponse.digest)

  const repository = github.context.repo
  const artifactURL = `${github.context.serverUrl}/${repository.owner}/${repository.repo}/actions/runs/${github.context.runId}/artifacts/${uploadResponse.id}`

  core.info(`Artifact download URL: ${artifactURL}`)
  core.setOutput('artifact-url', artifactURL)
  verboseLog(`Set outputs artifact-id, artifact-digest, artifact-url`, verbose)
}
