CREATE TYPE "public"."account_type" AS ENUM('asset', 'liability', 'equity', 'income', 'expense', 'contra_asset', 'contra_liability');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."normal_balance" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."transaction_direction" AS ENUM('income', 'expense');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('draft', 'submitted', 'approved', 'rejected', 'posted');--> statement-breakpoint
CREATE TYPE "public"."announcement_scope" AS ENUM('public', 'internal', 'urgent');--> statement-breakpoint
CREATE TYPE "public"."event_status" AS ENUM('draft', 'published', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."post_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."program_status" AS ENUM('draft', 'active', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive', 'invited');--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"code" varchar(20) NOT NULL,
	"name" varchar(200) NOT NULL,
	"account_type" "account_type" NOT NULL,
	"normal_balance" "normal_balance" NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "accounts_tenantId_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "approval_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"stage_id" uuid,
	"user_id" uuid NOT NULL,
	"action" varchar(50) NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "approval_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"stage_order" integer NOT NULL,
	"required_permission" varchar(100) NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_stages_transactionId_stageOrder_unique" UNIQUE("transaction_id","stage_order")
);
--> statement-breakpoint
CREATE TABLE "journal_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"journal_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"debit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "jl_debit_non_neg" CHECK ("journal_lines"."debit" >= 0),
	CONSTRAINT "jl_credit_non_neg" CHECK ("journal_lines"."credit" >= 0),
	CONSTRAINT "jl_debit_xor_credit" CHECK (("journal_lines"."debit" > 0 AND "journal_lines"."credit" = 0) OR ("journal_lines"."debit" = 0 AND "journal_lines"."credit" > 0))
);
--> statement-breakpoint
CREATE TABLE "journals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"journal_no" varchar(50) NOT NULL,
	"journal_date" timestamp with time zone NOT NULL,
	"transaction_id" uuid,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "journals_tenantId_journalNo_unique" UNIQUE("tenant_id","journal_no")
);
--> statement-breakpoint
CREATE TABLE "transaction_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(200) NOT NULL,
	"direction" "transaction_direction" NOT NULL,
	"debit_account_id" uuid NOT NULL,
	"credit_account_id" uuid NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transaction_categories_tenantId_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"transaction_no" varchar(50) NOT NULL,
	"transaction_date" timestamp with time zone NOT NULL,
	"category_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"description" text,
	"reference_no" varchar(100),
	"status" "transaction_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"posted_at" timestamp with time zone,
	"posted_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "transactions_tenantId_transactionNo_unique" UNIQUE("tenant_id","transaction_no"),
	CONSTRAINT "tx_amount_positive" CHECK ("transactions"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"user_id" uuid,
	"action" varchar(100) NOT NULL,
	"resource" varchar(100),
	"resource_id" uuid,
	"ip_address" varchar(45),
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"scope" "announcement_scope" DEFAULT 'public' NOT NULL,
	"published_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "announcements_tenantId_slug_unique" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "event_rsvps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"email" varchar(255),
	"phone" varchar(30),
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_speakers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"role" varchar(100),
	"bio" text,
	"photo_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"cover_url" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"location" text,
	"rsvp_enabled" boolean DEFAULT false NOT NULL,
	"rsvp_capacity" integer,
	"status" "event_status" DEFAULT 'draft' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "events_tenantId_slug_unique" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "galleries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"cover_url" text,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "galleries_tenantId_slug_unique" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "gallery_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"file_url" text NOT NULL,
	"caption" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"type" varchar(50) NOT NULL,
	"title" varchar(200) NOT NULL,
	"body" text,
	"link_url" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(200) NOT NULL,
	"excerpt" text,
	"body" text NOT NULL,
	"cover_url" text,
	"seo_title" varchar(200),
	"seo_description" varchar(500),
	"status" "post_status" DEFAULT 'draft' NOT NULL,
	"published_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "posts_tenantId_slug_unique" UNIQUE("tenant_id","slug")
);
--> statement-breakpoint
CREATE TABLE "programs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"slug" varchar(200) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"cover_url" text,
	"target_amount" numeric(18, 2),
	"collected_amount" numeric(18, 2) DEFAULT '0',
	"start_date" timestamp with time zone,
	"end_date" timestamp with time zone,
	"status" "program_status" DEFAULT 'draft' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "programs_tenantId_slug_unique" UNIQUE("tenant_id","slug"),
	CONSTRAINT "prog_target_non_neg" CHECK ("programs"."target_amount" IS NULL OR "programs"."target_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(100) NOT NULL,
	"module" varchar(50) NOT NULL,
	"action" varchar(100) NOT NULL,
	"description" text,
	CONSTRAINT "permissions_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	CONSTRAINT "role_permissions_role_id_permission_id_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"description" text,
	"is_system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "roles_tenantId_code_unique" UNIQUE("tenant_id","code")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"token" varchar(500) NOT NULL,
	"ip_address" varchar(45),
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(63) NOT NULL,
	"name" varchar(200) NOT NULL,
	"short_name" varchar(100),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "tenants_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	CONSTRAINT "user_roles_user_id_role_id_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" varchar(255) NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"password_hash" varchar(255),
	"name" varchar(200) NOT NULL,
	"avatar_url" text,
	"status" "user_status" DEFAULT 'invited' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "users_tenantId_email_unique" UNIQUE("tenant_id","email")
);
--> statement-breakpoint
CREATE TABLE "mosque_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"official_name" varchar(200),
	"short_name" varchar(100),
	"province" varchar(100),
	"city" varchar(100),
	"district" varchar(100),
	"village" varchar(100),
	"postal_code" varchar(10),
	"address_detail" text,
	"latitude" varchar(30),
	"longitude" varchar(30),
	"phone" varchar(30),
	"email" varchar(255),
	"website" varchar(255),
	"youtube_url" varchar(255),
	"facebook_url" varchar(255),
	"instagram_url" varchar(255),
	"tiktok_url" varchar(255),
	"logo_url" text,
	"banner_url" text,
	"bank_name" varchar(100),
	"bank_account_name" varchar(200),
	"bank_account_number" varchar(50),
	"history" text,
	"vision" text,
	"mission" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mosque_profiles_tenantId_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
CREATE TABLE "officer_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"officer_id" uuid NOT NULL,
	"title" varchar(200) NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" varchar(100),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "officers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"position_id" uuid NOT NULL,
	"name" varchar(200) NOT NULL,
	"photo_url" text,
	"phone" varchar(30),
	"email" varchar(255),
	"bio" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(200) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_accounts_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_logs" ADD CONSTRAINT "approval_logs_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_logs" ADD CONSTRAINT "approval_logs_stage_id_approval_stages_id_fk" FOREIGN KEY ("stage_id") REFERENCES "public"."approval_stages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_logs" ADD CONSTRAINT "approval_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_id_journals_id_fk" FOREIGN KEY ("journal_id") REFERENCES "public"."journals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journals" ADD CONSTRAINT "journals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_debit_account_id_accounts_id_fk" FOREIGN KEY ("debit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_categories" ADD CONSTRAINT "transaction_categories_credit_account_id_accounts_id_fk" FOREIGN KEY ("credit_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_category_id_transaction_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."transaction_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_submitted_by_users_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_rsvps" ADD CONSTRAINT "event_rsvps_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speakers" ADD CONSTRAINT "event_speakers_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "galleries" ADD CONSTRAINT "galleries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gallery_items" ADD CONSTRAINT "gallery_items_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "programs" ADD CONSTRAINT "programs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mosque_profiles" ADD CONSTRAINT "mosque_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_documents" ADD CONSTRAINT "officer_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officer_documents" ADD CONSTRAINT "officer_documents_officer_id_officers_id_fk" FOREIGN KEY ("officer_id") REFERENCES "public"."officers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_period_id_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "officers" ADD CONSTRAINT "officers_position_id_positions_id_fk" FOREIGN KEY ("position_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "periods" ADD CONSTRAINT "periods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "positions" ADD CONSTRAINT "positions_parent_id_positions_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."positions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "accounts_tenant_id_index" ON "accounts" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "accounts_parent_id_index" ON "accounts" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "approval_logs_transaction_id_index" ON "approval_logs" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "approval_stages_transaction_id_index" ON "approval_stages" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "journal_lines_journal_id_index" ON "journal_lines" USING btree ("journal_id");--> statement-breakpoint
CREATE INDEX "journal_lines_account_id_index" ON "journal_lines" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "journals_tenant_id_journal_date_index" ON "journals" USING btree ("tenant_id","journal_date");--> statement-breakpoint
CREATE INDEX "journals_transaction_id_index" ON "journals" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "transaction_categories_tenant_id_index" ON "transaction_categories" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "transactions_tenant_id_transaction_date_index" ON "transactions" USING btree ("tenant_id","transaction_date");--> statement-breakpoint
CREATE INDEX "transactions_status_index" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_id_created_at_index" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_user_id_index" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_index" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "announcements_tenant_id_published_at_index" ON "announcements" USING btree ("tenant_id","published_at");--> statement-breakpoint
CREATE INDEX "event_rsvps_event_id_index" ON "event_rsvps" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "event_speakers_event_id_index" ON "event_speakers" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "events_tenant_id_starts_at_index" ON "events" USING btree ("tenant_id","starts_at");--> statement-breakpoint
CREATE INDEX "gallery_items_gallery_id_index" ON "gallery_items" USING btree ("gallery_id");--> statement-breakpoint
CREATE INDEX "notifications_user_id_read_at_index" ON "notifications" USING btree ("user_id","read_at");--> statement-breakpoint
CREATE INDEX "posts_tenant_id_status_index" ON "posts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "programs_tenant_id_index" ON "programs" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_index" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_tenant_id_index" ON "sessions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_at_index" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "users_tenant_id_index" ON "users" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "officer_documents_officer_id_index" ON "officer_documents" USING btree ("officer_id");--> statement-breakpoint
CREATE INDEX "officers_tenant_id_index" ON "officers" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "officers_period_id_index" ON "officers" USING btree ("period_id");--> statement-breakpoint
CREATE INDEX "officers_position_id_index" ON "officers" USING btree ("position_id");--> statement-breakpoint
CREATE INDEX "periods_tenant_id_index" ON "periods" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "positions_tenant_id_index" ON "positions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "positions_parent_id_index" ON "positions" USING btree ("parent_id");