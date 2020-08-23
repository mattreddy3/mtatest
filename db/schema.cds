namespace redfig.plantmaint;
using { User, Country, Currency, managed, cuid } from '@sap/cds/common';
entity tenant {
	tenantID	: UUID @mandatory;
	deletionInd	: Boolean;
}

define type NotificationStatus : Integer enum {
	Draft			= 01;
	Open			= 10;
	OrderAssigned	= 20;
	Completed		= 50;
	Cancelled		= 90;
};

define type OrderStatus : Integer enum { 
	Draft			= 01;
	Created 		= 10;
	Released		= 20;
	PartConfirmed	= 30;
	FinalConfirmed	= 40;
	Completed		= 50;
	Deleted			= 90;
};

define type OperationStatus : Integer enum { 
	Created 		= 10;
	Released		= 20;
	PartConfirmed	= 30;
	FinalConfirmed	= 40;
};
	
entity ObjAction : cuid, tenant {
	ObjectType			: String(2) enum {
		notificationHeader	= 'NH';
		orderHeader			= 'OH;'
	};
	virtual ObjectID	: UUID;
	ActionName			: String(20);		
	ActionDesc			: String(30);			// This should be text shown in the button
	ActionType			: String(1) enum {
		standard = 'S';							//Standard Application Action
		customer = 'C';							//Customer Specific Action
	};
	ActionEvent			: String;				//CREATE, UPDATE, or custom action
	ActionEntity		: String;				//Which entity this acts on
	ActionExpression	: String(1) enum {		//What type of button to show
		confirmation = 'S';
		cancelation  = 'E';
		information  = 'I';
	};
	NewStatus		: Integer;			// New Status that will result from this action
	Scope			: String(30);
};
aspect redfigManaged : managed {
		createdUserInfo		: Association to one UserInfo on createdUserInfo.Email = createdBy;
		modifiedUserInfo	: Association to one UserInfo on modifiedUserInfo.Email = modifiedBy;
}
entity UserInfo: cuid, tenant {
	DisplayName		: String(40);
	Email			: String(248);
}

// Notification
entity NotificationHeader : cuid, redfigManaged, tenant {
		ERPID							: String(30);
		ERPFunction						: String(1);
		lastSynchLog					: Association to DataSynchLog;
    	NotificationNo      			: String(12)						@(title:'{i18n>NotificationNo}');
    	@readonly NotificationStatus	: NotificationStatus;
        virtual NotificationStatusDesc	: String(30);
        functionalLocation  			: Association to FunctionalLocation;
        equipment						: Association to Equipment;
        workCenter		    			: Association to WorkCenter;
        notificationType    			: Association to NotificationType	@(title:'{i18n>NotificationType}');
        priorityCode        			: Association to PriorityCode		@(title:'{i18n>Priority}');
        ShortText           			: String(40)						@(title:'{i18n>ShortText}');
        Breakdown           			: Boolean							@(title:'{i18n>Breakdown}');
        OrderNo             			: String(12)						@(title:'{i18n>OrderNo}');
        Reporter            			: String(40)						@(title:'{i18n>Reporter}');
        NotificationDateTime			: Timestamp 						@(title:'{i18n>NotificationDateTime}');
        RequiredStartDateTime			: Timestamp 						@(title:'{i18n>RequiredStartDateTime}');
        RequiredEndDateTime 			: Timestamp 						@(title:'{i18n>RequiredEndDate}');
        LongText            			: LargeString						@(title:'{i18n>LongText}');
        Items							: Composition of many NotificationItem	 on Items.notification = $self;
        Activities						: Composition of many NotificationActivity on Activities.notification = $self;
        NotificationTexts				: Composition of many NotificationText on NotificationTexts.notification = $self;
		ObjectType						: String(2);
        objActions						: Association to many ObjAction on objActions.ObjectType = ObjectType;
};

entity NotificationText : cuid, redfigManaged, tenant {
		ERPID				: String(30);
		notification		: Association to NotificationHeader;
		Count				: Integer;
		ERPFunction			: String(1);
		Source				: String(3) enum {
			APP = 'APP';							//Text was creted via the App
			ERP = 'ERP';							//Text came from ERP
		};
		DateTime			: DateTime;
		LongText			: LargeString;
		TextID				: String(4);
};

entity NotificationItem : cuid, redfigManaged, tenant {
		ERPID					: String(30);
		ERPFunction				: String(1);
		notification			: Association to NotificationHeader;
    	NotificationItemNo  	: Integer;
        ShortText           	: String(40);
        codeGroup           	: Association to CodeGroup;
        code                	: Association to Code;
};

entity NotificationActivity: cuid, redfigManaged, tenant {
		ERPID					: String(30);
		ERPFunction				: String(1);
        notification        	: Association to NotificationHeader;
    	NotificationActivityNo	: Integer;
        notificationItem    	: Association to NotificationItem;
        codeGroup           	: Association to CodeGroup;
        code                	: Association to Code;
        ActivityText        	: String(40);
};


// Work Orders
entity OrderHeader : cuid, redfigManaged, tenant {
		ERPID					: String(30);
		ERPFunction				: String(1);
		OrderNo					: String(12);
		lastSynchLog			: Association to DataSynchLog;
		OrderStatus				: OrderStatus;
		virtual OrderStatusDesc	: String;
		orderType				: Association to OrderType;
		functionalLocation		: Association to FunctionalLocation;
		workCenter				: Association to WorkCenter;
		equipment				: Association to Equipment;
		ShortText				: String(40);
		priorityCode			: Association to PriorityCode;
		Breakdown				: Boolean;
		notification			: Association to NotificationHeader;
		RequiredStartDateTime	: Timestamp;
		RequiredEndDateTime		: Timestamp;
		Operations				: Composition of many OrderOperation	on Operations.workOrder = $self;
		Components				: Composition of many OrderComponent	on Components.workOrder = $self;
		Confirmations			: Composition of many OrderConfirmation on Confirmations.workOrder = $self;
		Movements				: Composition of many OrderMovement		on Movements.workOrder = $self;
		ObjectType				: String(2);
        objActions				: Association to many ObjAction on objActions.ObjectType = ObjectType;
};

entity OrderOperation : cuid, redfigManaged, tenant {
		ERPID						: String(30);
		ERPFunction					: String(1);
		workOrder					: Association to OrderHeader;
		OrderOperationNo			: String(4);					// limit Integer to 4 places? or String with only numbers?
		OperationStatus				: OperationStatus;
		virtual OperationStatusDesc	: String(20);					
		ShortText					: String(40);
		workCenter					: Association to WorkCenter;
		WorkRequired				: Decimal(7,1);					//Planned Hours in this Operation
		virtual WorkConfirmed		: Decimal (7,1);				//Hours Already Confirmed, 	
		WorkUoM						: String(3);
		Duration					: Decimal (7,1);
		DurationUoM					: String(3);
};

entity OrderComponent : cuid, redfigManaged, tenant {
		ERPID						: String(30);
		ERPFunction					: String(1);
		workOrder					: Association to OrderHeader;
		OrderComponentNo			: String(4);
		material					: Association to Material;
		ComponentDesc				: String(40);
		QuantityRequired			: Decimal (13,3);
		virtual QuantityWithdrawn	: Decimal (13,3);			//Calculated based on Goods Movements
		QuantityUoM					: String(3);
		orderOperation				: Association to OrderOperation;
		plant						: Association to Plant;
		storageLocation				: Association to StorageLocation;
};

entity OrderConfirmation: cuid, redfigManaged, tenant {
		ERPID					: String(30);
		ERPFunction				: String(1);
		workOrder				: Association to OrderHeader;
		Counter					: Integer;						
		virtual Status			: Integer enum {	
			Partial 	= 0;
			Final		= 1;
			Cancelled   = 2; 
		};
		virtual StatusDesc		: String(10);		
		WorkActual				: Decimal (7,1);
		WorkUoM					: String(3);
		WorkStart				: DateTime;
		WorkEnd					: DateTime;
		FinalConfirmation		: Boolean;
		ConfirmationText		: String(40);
		Reversed				: Boolean;
		orderOperation			: Association to OrderOperation;
		cancelledConfirmation	: Association to OrderConfirmation;
};

entity OrderMovement : cuid, redfigManaged, tenant {
		ERPID				: String(30);
		ERPFunction			: String(1);
		workOrder			: Association to OrderHeader;
		MaterialDoc			: String(10);
		MaterialDocYear		: Integer;
		MaterialDocItem		: Integer;
		DocumentDate		: DateTime;
		PostingDate			: DateTime;
		plant				: Association to Plant;
		storageLocation		: Association to StorageLocation;
		material			: Association to Material;
		Batch				: String(10);	
		Quantity			: Decimal(13,3);
		UoM					: String(3);
		ItemText			: String(50);
		Cancelled			: Boolean;
		orderComponent		: Association to OrderComponent;
		orderOperation		: Association to OrderOperation;
		cancelledMovement	: Association to OrderMovement;
};



//-----------------------------------------------------------------------------------------------------
// Master Data
//-----------------------------------------------------------------------------------------------------

entity WorkCenter : cuid, tenant, redfigManaged {
		ERPID			: String(30);
		WorkCenterID	: String(8);
		LastSynch		: DateTime;
		WorkCenterDesc	: String(40);
		Plant			: Association to Plant;
        notifications	: Association to many NotificationHeader on notifications.workCenter = $self;
        orders			: Association to many OrderHeader on orders.workCenter = $self;

};
entity FunctionalLocation : cuid, tenant, redfigManaged {
		ERPID						: String(30);
    	FunctionalLocationID    	: String(30);
    	LastSynch					: DateTime;
        FunctionalLocationDesc  	: String(40);
        Category                	: String(1);
        HierarchyLevel			    : Integer;
        parentFunctionalLocation	: Association to FunctionalLocation;
        CreatedDate             	: DateTime;
        ChangedDate             	: DateTime;
        Plant                   	: Association to Plant;
        equipment					: Association to many Equipment on equipment.functionalLocation = $self;
        workCenter					: Association to WorkCenter;
        notifications				: Association to many NotificationHeader on notifications.functionalLocation = $self;
};
entity Equipment : cuid, tenant, redfigManaged {
		ERPID				: String(30);
		LastSynch			: DateTime;
		EquipmentDesc		: String(40);
		EquipmentCategory	: String(1);
		EquipmentType		: String(10);
		functionalLocation	: Association to FunctionalLocation;
};

entity Material : cuid, tenant, redfigManaged {
		ERPID			: String(30);
		MaterialNo		: String(18);
        LastSynch   	: DateTime;
        MaterialType	: String(4);
        MaterialDesc	: String(40);
        ChangedDate 	: DateTime;		// From SAP
        CreatedDate 	: DateTime;		// From SAP
        BaseUoM			: String(3);
        orderMovement	: Association to many OrderMovement on orderMovement.material = $self;
        MaterialSLocs	: Composition of many MaterialSLoc	on MaterialSLocs.material = $self;
        MaterialPlants	: Composition of many MaterialPlant on MaterialPlants.material = $self;
};

entity MaterialPlant : cuid, tenant, redfigManaged {
		ERPID			: String(30);
		material		: Association to Material;
		plant			: Association to Plant;
};

entity MaterialSLoc : cuid, tenant, redfigManaged {
		ERPID			: String(30);
		material		: Association to Material;
		plant			: Association to Plant;
		storageLocation	: Association to StorageLocation;
		StorageBin		: String(10);
};


//-----------------------------------------------------------------------------------------------------
// Configuration Data
//-----------------------------------------------------------------------------------------------------

entity Plant :  cuid, tenant, redfigManaged {
		ERPID			: String(30);
		PlantID			: String(4);
		PlantDesc		: String(30);
		materialSLoc	: Association to many MaterialSLoc on materialSLoc.plant = $self;
        orderComponent	: Association to many OrderComponent on orderComponent.plant = $self;
}

entity StorageLocation :  cuid, tenant, redfigManaged {
		ERPID					: String(30);
		Plant					: Association to Plant;
		StorageLocationID		: String(4);
		StorageLocationDesc		: String(16);
		materialSLoc			: Association to many MaterialSLoc on materialSLoc.storageLocation = $self;
        orderComponent			: Association to many OrderComponent on orderComponent.storageLocation = $self;
}

entity NotificationType : cuid, tenant, redfigManaged {
		ERPID					: String(30);
    	NotificationTypeID  	: String(2);
        NotificationCategory	: String(2);
        NotificationTypeDesc	: String(20);
        codeGroups				: Association to many CodeGroup on codeGroups.notificationType = $self;
        notifications			: Association to many NotificationHeader on notifications.notificationType = $self;
        dataSynchObject			: Association to DataSynchObject;
};
entity OrderType :cuid, tenant, redfigManaged{
		ERPID					: String(30);
		OrderTypeID				: String(4);
		OrderTypeDesc			: String(40);
		dataSynchObject			: Association to DataSynchObject;
};
entity PriorityType: cuid, tenant, redfigManaged {
		ERPID					: String(30);
    	PriorityTypeID      	: String(2);
        PriorityTypeDesc		: String(20);
        // notifications			: Association to many NotificationHeader on notifications.priorityType = $self;
		dataSynchObject			: Association to DataSynchObject;

};
entity PriorityCode : cuid, tenant, redfigManaged {
		ERPID					: String(30);
    	priorityType    		: Association to PriorityType;
    	PriorityCodeID     		: String(1);
        RelStartDate    		: Integer;
        RelStartDateUnit		: String(3);
        RelEndDate      		: Integer;
        RelEndDateUnit  		: String(3);
        PriorityDesc    		: String(20);
        notifications			: Association to many NotificationHeader on notifications.priorityCode = $self;
        dataSynchObject			: Association to DataSynchObject;
};
entity CodeGroup : cuid, tenant, redfigManaged {	
		ERPID					: String(30);
    	Catalog     			: String(1);
    	CodeGroupID 			: String(8);
        CodeGroupDesc			: String(40);
        notificationType		: Association to NotificationType;
        codes					: Association to many Code on codes.codeGroup = $self;
        dataSynchObject			: Association to DataSynchObject;
};
entity Code	: cuid, tenant, redfigManaged {
		ERPID					: String(30);
    	Catalog     			: String(1);
    	codeGroup				: Association to CodeGroup;
    	CodeID      			: String(4);
        CodeDesc    			: String(40);
        dataSynchObject			: Association to DataSynchObject;
};

//-----------------------------------------------------------------------------------------------------
// Datasynch/technical
//-----------------------------------------------------------------------------------------------------

type SynchStatus : String(1) enum {
	pending		= 'P';		// Ready to Synch on next Run
	success 	= 'S';		// Synch was successful
	warning 	= 'W';		// Was able to Synch, but some issues happened
	error   	= 'E';		// Was not able to Synch
	cleared 	= 'C';		// Error -> Cleared by user
	resolved	= 'R';		// Error -> Addressed by a subsequent Error Entry (DataSynchLog.resolvedBy)
};

entity DataSynchJob : cuid, tenant {
	Status : Integer enum {
		running = 1;
		stopped = 0;
	};
	LastRun 	: DateTime;
	Processed	: Integer;
	Successes	: Integer;
	Errors		: Integer;
	Runtime		: Integer
};

entity DataSynchObject : cuid, tenant {
		SynchOrder			: Integer;
		ServiceName			: String(40) @mandatory;
    	EntityName      	: String(40) @mandatory;
        DataType        	: String(20) enum {
        	master		= 'M';
        	config		= 'C';
        	transaction	= 'T';	
        };
        Direction		: String (3) enum {
        	outbound	= 'OUT';
        	inbound		= 'IN';
        };
        Method				: String(1) enum {
        	realTime	= 'R';
        	periodic	= 'P';
        };
        Frequency       	: Integer;
        LastSynch			: DateTime;
        LastSynchStatus		: SynchStatus;
		DataSynchLogs		: association to many DataSynchLog		on DataSynchLogs.objectType = $self;
		
		//	Need Compositions for all Condig data, as Config data is updated using a Deep Update on DataSynchObject
		// NotificationTypes	: Composition of many NotificationType	on NotificationTypes.dataSynchObject = $self;
		// OrderTypes			: Composition of many OrderType 		on OrderTypes.dataSynchObject = $self;
		// PriorityTypes		: Composition of many PriorityType 		on PriorityTypes.dataSynchObject = $self;
		// PriorityCodes		: Composition of many PriorityCode 		on PriorityCodes.dataSynchObject = $self;
		// CodeGroups			: Composition of many CodeGroup 		on CodeGroups.dataSynchObject = $self;
		// Codes				: Composition of many Code		 		on Codes.dataSynchObject = $self;
		
};

entity DataSynchLog :cuid, tenant, redfigManaged {
    	objectType		: association to DataSynchObject;
        ObjectID    	: UUID;						//ID of Object that needs to synch (ex: Notificaiton Number), can be NULL TO indicate all
        SynchStatus		: SynchStatus;
        Message			: String(200);
        resolvedBy		: association to DataSynchLog;	//If Error, this stores the susequent log post that addresses this error
};

entity TestCase :cuid, tenant, redfigManaged {
	Description		: String(200);
	Result			: String(1);
	Steps			: Integer;
	StepsSuccess	: Integer;
	StepsError		: Integer; 
	virtual Message	: LargeString; 
}

entity NumberRange :cuid, tenant  {
	RangeID:		String(10) @mandatory;
	CurrentNumber:	Integer;
	FirstNumber:	Integer;
	LastNumber: 	Integer;
}
