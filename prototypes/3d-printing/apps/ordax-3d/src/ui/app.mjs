import { mountProductHost } from "/product-host.mjs";
import { createTechnicalJobsService } from "/apps/ordax-3d/src/application/technical-jobs-service.mjs";
import { createAppDataTechnicalJobRepository } from "/apps/ordax-3d/src/adapters/app-data-technical-job-repository.mjs";
import { areas } from "./views.mjs";

export function mountApp(services) {
  const technicalJobs = createTechnicalJobsService(createAppDataTechnicalJobRepository(services.appData));
  return mountProductHost({
    appId: "ordax-3d",
    title: "OrdaX 3D",
    subtitle: "IMPRESSÃO 3D",
    mark: "3D",
    areas,
    initialAreaId: "slicing",
    services: { ...services, technicalJobs },
  });
}
