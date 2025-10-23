CREATE TABLE `material_sn_record` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT COMMENT '主键id',
  `tenant_id` varchar(40) NOT NULL COMMENT '租户id',
  `content_biz_id` varchar(64) NOT NULL COMMENT '主表单id',
  `subform_content_biz_id` varchar(64) NOT NULL COMMENT '子表单id',
  `material_id` bigint(20) NOT NULL COMMENT '物料ID',
  `material_code` varchar(64) NOT NULL COMMENT '物料编号',
  `sn_code` varchar(64) NOT NULL COMMENT 'SN码',
  `create_time` datetime DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subform_content_biz_id` (`subform_content_biz_id`),
  UNIQUE KEY `uk_sn_code` (`sn_code`)
) ENGINE=InnoDB AUTO_INCREMENT=3 DEFAULT CHARSET=utf8mb4 COMMENT='SN码记录表';