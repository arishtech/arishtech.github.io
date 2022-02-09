<?php
/**
 * The template for displaying archive pages
 *
 * @link https://developer.wordpress.org/themes/basics/template-hierarchy/
 *
 * @package Restly
 */

get_header();
$restly_archiveLayout = restly_options('restly_archive_layout', 'right-sidebar');
$restly_archive_banner = restly_options('restly_archive_banner', true);
$restly_archive_pagination = restly_options('restly_archive_pagination', true);
if($restly_archiveLayout == 'grid'){
	$restly_sidebar_bg = 'sidebar-no-bg-main';
}else{
	$restly_sidebar_bg = 'sidebar-bg-main';
}
?>
	<?php if($restly_archive_banner == true ) : ?>
	<div class="breadcroumb-area">
		<div class="container">
			<div class="breadcroumn-contnt">
				<?php the_archive_title( '<h2 class="archive-title">', '</h2>' ); ?>
				<div class="bre-sub">
				<?php if(function_exists('bcn_display')){
					bcn_display();
				}?>
				</div>
			</div>
		</div>
	</div>
	<?php endif; ?>
	<main id="primary" class="site-main content-area <?php echo esc_attr($restly_sidebar_bg); ?>">
		<div class="container page-layout <?php echo esc_attr($restly_archiveLayout); ?>">
			<?php
				if ( $restly_archiveLayout == 'grid' ) {
					get_template_part( 'template-parts/blog/post-grid' );
				} else {
					get_template_part( 'template-parts/blog/post-sidebar' );
				}?>
				
		</div>
	</main><!-- #main -->
<?php get_footer();
