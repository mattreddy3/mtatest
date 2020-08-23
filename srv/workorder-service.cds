using {
    redfig.plantmaint as my,
    sap.common
} from '../db/schema';

@path     : '/order'
@impl     : './impl/workorder-service'
@requires : 'REDFIG_W_WORDER_VIEW_OWN'
service WorkOrderService {
    //	Work Order
    entity Orders             as projection on my.OrderHeader {
        * , equipment.ERPID as EquipmentID, equipment.EquipmentDesc as EquipmentDesc, functionalLocation.FunctionalLocationID as FunctionalLocationID, functionalLocation.FunctionalLocationDesc as FunctionalLocationDesc, orderType.OrderTypeID as OrderTypeID, orderType.OrderTypeDesc as OrderTypeDesc, priorityCode.PriorityCodeID as PriorityCodeID, priorityCode.PriorityDesc as PriorityDesc, workCenter.WorkCenterID as WorkCenterID, workCenter.WorkCenterDesc as WorkCenterDesc, notification.NotificationNo as NotificationNo, createdUserInfo.DisplayName as CreatedByName, modifiedUserInfo.DisplayName as ModifiedByName
    } actions {
        action process(actionName : String(10))
    };

    entity OrderOperations    as projection on my.OrderOperation {
        * , workCenter.WorkCenterID as WorkCenterID, workCenter.WorkCenterDesc as WorkCenterDesc, workOrder.OrderNo as OrderNo, createdUserInfo.DisplayName as CreatedByName, modifiedUserInfo.DisplayName as ModifiedByName
    };

    entity OrderComponents    as projection on my.OrderComponent {
        * , material.MaterialNo as MaterialNo, material.MaterialDesc as MaterialDesc, workOrder.OrderNo as OrderNo, orderOperation.OrderOperationNo as OrderOperationNo, plant.PlantID as PlantID, plant.PlantDesc as PlantDesc, storageLocation.StorageLocationID as StorageLocationID, storageLocation.StorageLocationDesc as StorageLocationDesc, createdUserInfo.DisplayName as CreatedByName, modifiedUserInfo.DisplayName as ModifiedByName
    };

    entity OrderConfirmations as projection on my.OrderConfirmation {
        * , workOrder.OrderNo as OrderNo, orderOperation.OrderOperationNo as OrderOperationNo, createdUserInfo.DisplayName as CreatedByName, modifiedUserInfo.DisplayName as ModifiedByName
    };

    entity OrderMovements     as projection on my.OrderMovement {
        * , workOrder.OrderNo as OrderNo, orderOperation.OrderOperationNo as OrderOperationNo, orderComponent.OrderComponentNo as OrderComponentNo, material.MaterialNo as MaterialNo, material.MaterialDesc as MaterialDesc, createdUserInfo.DisplayName as CreatedByName, modifiedUserInfo.DisplayName as ModifiedByName
    };

    entity ObjActions         as projection on my.ObjAction {
        *
    };

}
