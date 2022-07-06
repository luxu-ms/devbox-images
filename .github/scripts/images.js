const fs = require('fs/promises');
const yaml = require('js-yaml');

module.exports = async ({ github, context, core, glob, exec, }) => {

    const { resourceGroup, galleryName } = process.env;
    const workspace = process.env.GITHUB_WORKSPACE;

    core.startGroup(`Checking for changed files`);

    const compare = await github.rest.repos.compareCommitsWithBasehead({
        owner: context.repo.owner,
        repo: context.repo.repo,
        basehead: `${context.payload.before}...${context.payload.after}`
    });

    const changes = compare.data.files.map(f => f.filename);

    core.info(`Found ${changes.length} changed files`);
    for (const c of changes) {
        core.info(`- ${c}`);
    }

    core.endGroup();

    const patterns = ['**/image.yml', '**/image.yaml']
    const globber = await glob.create(patterns.join('\n'));
    const files = await globber.glob();

    let include = [];

    for (const file of files) {

        const imageName = file.split('/').slice(-2)[0];

        core.startGroup(`Processing image config ${imageName} : ${file}`);

        const contents = await fs.readFile(file, 'utf8');
        const image = yaml.load(contents);

        image.name = imageName;
        image.gallery = galleryName;
        image.resourceGroup = resourceGroup;

        image.source = file.split('/image.y')[0];
        image.path = image.source.split(`${workspace}/`)[1];
        image.changed = changes.some(change => change.startsWith(image.path) || change.startsWith(`scripts/`));

        image.locations = JSON.stringify(image.locations);

        if (!image.version) {
            core.warning(`Skipping ${imageName} because of missing version information`);
        } else {

            const imgDefShowCmd = [
                'sig', 'image-definition', 'show',
                '--only-show-errors',
                '-g', resourceGroup,
                '-r', galleryName,
                '-i', imageName
            ];

            core.info(`Checking if image definition exists for ${imageName}`);
            const imgDefShow = await exec.getExecOutput('az', imgDefShowCmd, { silent: true, ignoreReturnCode: true });

            if (imgDefShow.exitCode === 0) {

                core.info(`Found existing image ${imageName}`);
                const img = JSON.parse(imgDefShow.stdout);
                image.location = img.location;

            } else if (imgDefShow.stderr.includes('Code: ResourceNotFound')) {

                core.info(`Image ${imageName} does not exist in gallery ${galleryName}`);

                const imgDefCreateCmd = [
                    'sig', 'image-definition', 'create',
                    '--only-show-errors',
                    '-g', resourceGroup,
                    '-r', galleryName,
                    '-i', imageName,
                    '-p', image.publisher,
                    '-f', image.offer,
                    '-s', image.sku,
                    '--os-type', image.os,
                    // '--os-state', 'Generalized', (default)
                    '--description', image.description,
                    '--hyper-v-generation', 'V2',
                    '--features', 'SecurityType=TrustedLaunch'
                ];

                core.info(`Creating new image definition for ${imageName}`);

                const imgDefCreate = await exec.getExecOutput('az', imgDefCreateCmd, { silent: true, ignoreReturnCode: true });

                if (imgDefCreate.exitCode === 0) {

                    core.info(`Created image definition for ${imageName}`);
                    const img = JSON.parse(imgDefCreate.stdout);
                    image.location = img.location;

                } else {
                    core.setFailed(`Failed to create image definition for ${imageName} \n ${imgDefCreate.stderr}`);
                }

            } else {
                core.setFailed(`Failed to get image definition for ${imageName} \n ${imgDefShow.stderr}`);
            }

            const imgVersionShowCmd = [
                'sig', 'image-version', 'show',
                '--only-show-errors',
                '-g', resourceGroup,
                '-r', galleryName,
                '-i', imageName,
                '-e', image.version
            ];

            core.info(`Checking if image version ${image.version} already exists for ${imageName}`);
            const imgVersionShow = await exec.getExecOutput('az', imgVersionShowCmd, { silent: true, ignoreReturnCode: true });

            if (imgVersionShow.exitCode !== 0) {

                if (imgVersionShow.stderr.includes('Code: ResourceNotFound')) {
                    core.info(`Image version ${image.version} does not exist for ${imageName}. Creating`);
                    include.push(image);
                } else {
                    core.setFailed(`Failed to check for existing image version ${image.version} for ${imageName} \n ${imgVersionShow.stderr}`);
                }

            } else if (image.changed) {
                core.setFailed(`Image version ${image.version} already exists for ${imageName} but image definition files changed. Please update the version number or delete the image version and try again.`);
            } else {
                core.info(`Image version ${image.version} already exists for ${imageName} and image definition is unchanged. Skipping`);
            }
        }

        core.endGroup();
    };


    if (include.length > 0) {
        const rows = [[{ data: 'Name', header: true }, { data: 'Publisher', header: true }, { data: 'Offer', header: true }, { data: 'SKU', header: true }, { data: 'OS', header: true }, { data: 'Version', header: true }]];
        for (const i of include) {
            rows.push([i.name, i.publisher, i.offer, i.sku, i.os, i.version]);
        }
        await core.summary
            .addHeading('Images prepared for update', 3)
            .addTable(rows).write();
    } else {
        await core.summary.addHeading('No images were built', 4).write();
    }

    const matrix = {
        include: include
    };
    core.info(`matrix:${matrix}`)
    core.setOutput('matrix', JSON.stringify(matrix));
    core.setOutput('build', matrix.include.length > 0);
};
