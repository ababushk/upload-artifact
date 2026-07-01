import * as core from '@actions/core'
import artifact, {
  UploadArtifactOptions,
  ArtifactNotFoundError
} from '@actions/artifact'
import {findFilesToUpload} from '../shared/search.js'
import {verboseLog} from '../shared/verbose-log.js'
import {getInputs} from './input-helper.js'
import {NoFileOptions} from './constants.js'
import {uploadArtifact} from '../shared/upload-artifact.js'

async function deleteArtifactIfExists(
  artifactName: string,
  verbose: boolean
): Promise<void> {
  verboseLog(
    `Overwrite enabled, attempting to delete existing artifact '${artifactName}'`,
    verbose
  )
  try {
    await artifact.deleteArtifact(artifactName)
    verboseLog(`Deleted existing artifact '${artifactName}'`, verbose)
  } catch (error) {
    if (error instanceof ArtifactNotFoundError) {
      core.debug(`Skipping deletion of '${artifactName}', it does not exist`)
      verboseLog(
        `No existing artifact named '${artifactName}' to delete`,
        verbose
      )
      return
    }

    // Best effort, we don't want to fail the action if this fails
    core.debug(`Unable to delete artifact: ${(error as Error).message}`)
    verboseLog(
      `Failed to delete artifact '${artifactName}': ${(error as Error).message}`,
      verbose
    )
  }
}

export async function run(): Promise<void> {
  const inputs = getInputs()

  verboseLog(
    `Starting upload-artifact action with inputs: ${JSON.stringify(
      {
        artifactName: inputs.artifactName,
        searchPath: inputs.searchPath,
        ifNoFilesFound: inputs.ifNoFilesFound,
        retentionDays: inputs.retentionDays ?? '<default>',
        compressionLevel: inputs.compressionLevel ?? '<default>',
        overwrite: inputs.overwrite,
        includeHiddenFiles: inputs.includeHiddenFiles,
        archive: inputs.archive,
        verbose: inputs.verbose
      },
      null,
      2
    )}`,
    inputs.verbose
  )

  verboseLog(
    `Searching for files to upload with path '${inputs.searchPath}' (includeHiddenFiles: ${inputs.includeHiddenFiles})`,
    inputs.verbose
  )
  const searchResult = await findFilesToUpload(
    inputs.searchPath,
    inputs.includeHiddenFiles,
    inputs.verbose
  )

  verboseLog(
    `File search complete - ${searchResult.filesToUpload.length} file(s), root directory: '${searchResult.rootDirectory}'`,
    inputs.verbose
  )

  if (searchResult.filesToUpload.length === 0) {
    verboseLog(
      `No files matched search path '${inputs.searchPath}', applying if-no-files-found: '${inputs.ifNoFilesFound}'`,
      inputs.verbose
    )
    // No files were found, different use cases warrant different types of behavior if nothing is found
    switch (inputs.ifNoFilesFound) {
      case NoFileOptions.warn: {
        core.warning(
          `No files were found with the provided path: ${inputs.searchPath}. No artifacts will be uploaded.`
        )
        break
      }
      case NoFileOptions.error: {
        core.setFailed(
          `No files were found with the provided path: ${inputs.searchPath}. No artifacts will be uploaded.`
        )
        break
      }
      case NoFileOptions.ignore: {
        core.info(
          `No files were found with the provided path: ${inputs.searchPath}. No artifacts will be uploaded.`
        )
        break
      }
    }
    verboseLog(`Action finished without uploading an artifact`, inputs.verbose)
  } else {
    const s = searchResult.filesToUpload.length === 1 ? '' : 's'
    core.info(
      `With the provided path, there will be ${searchResult.filesToUpload.length} file${s} uploaded`
    )
    core.debug(`Root artifact directory is ${searchResult.rootDirectory}`)

    // Validate that only a single file is uploaded when archive is false
    if (!inputs.archive && searchResult.filesToUpload.length > 1) {
      verboseLog(
        `Validation failed: archive=false requires a single file but ${searchResult.filesToUpload.length} were found`,
        inputs.verbose
      )
      core.setFailed(
        `When 'archive' is set to false, only a single file can be uploaded. Found ${searchResult.filesToUpload.length} files to upload.`
      )
      return
    }

    if (inputs.overwrite) {
      await deleteArtifactIfExists(inputs.artifactName, inputs.verbose)
    } else {
      verboseLog(
        `Overwrite disabled, existing artifact with the same name may cause upload to fail`,
        inputs.verbose
      )
    }

    const options: UploadArtifactOptions = {}
    if (inputs.retentionDays) {
      options.retentionDays = inputs.retentionDays
    }

    if (typeof inputs.compressionLevel !== 'undefined') {
      options.compressionLevel = inputs.compressionLevel
    }

    if (!inputs.archive) {
      options.skipArchive = true
      verboseLog(
        `Archive disabled (skipArchive), artifact name will be derived from file: '${searchResult.filesToUpload[0]}'`,
        inputs.verbose
      )
    }

    options.verbose = inputs.verbose

    verboseLog(`Beginning artifact upload`, inputs.verbose)
    await uploadArtifact(
      inputs.artifactName,
      searchResult.filesToUpload,
      searchResult.rootDirectory,
      options,
      inputs.verbose
    )
    verboseLog(`Action completed successfully`, inputs.verbose)
  }
}
